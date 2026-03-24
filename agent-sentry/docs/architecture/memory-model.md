# Memory Model Architecture

## Overview

The AgentSentry memory subsystem provides tamper-evident event storage with semantic search. Events are stored as a hash-linked chain, searchable via vector embeddings or text fallback, and persisted through a pluggable provider layer.

Source files: `src/memory/store.ts`, `src/memory/schema.ts`, `src/memory/providers/`, `src/memory/embeddings.ts`, `src/memory/enrichment.ts`.

---

## Hash-Chained Event Storage

Every `OpsEvent` carries two hash fields: `hash` (its own SHA-256 digest) and `prev_hash` (the hash of the preceding event). The genesis event uses `prev_hash = "0".repeat(64)`.

The hash is computed by `computeHash()` in `schema.ts`. It serializes a deterministic JSON object containing all event fields except `hash` and `embedding`, then runs `crypto.createHash('sha256')` over the result.

When `MemoryStore.capture()` is called:

1. The input is validated via `validateEventInput()`.
2. A UUID is assigned as the event ID.
3. `prev_hash` is set to the last known hash held in memory (`this.lastHash`).
4. The hash is computed over `{id, timestamp, session_id, agent_id, event_type, severity, skill, title, detail, affected_files, tags, metadata, prev_hash}`.
5. An embedding is generated (if a provider with `dimension > 0` is available).
6. The event is inserted via the storage provider, and `this.lastHash` is updated.

### What the chain guarantees

- **Ordering**: Any reordering of events breaks `prev_hash` linkage.
- **Immutability**: Any modification to a stored event changes its hash, breaking the chain from that point forward.
- **Completeness**: Deleting an event breaks the chain at the gap.

These are integrity guarantees, not cryptographic signatures -- they detect accidental corruption or naive tampering, not adversarial attacks with write access to the database.

### Chain Verification

`verifyChain()` in `store.ts` walks the event chain and checks two properties for each event:

1. Recomputing the hash from the event's fields matches the stored `hash`.
2. The event's `prev_hash` matches the preceding event's `hash`.

Verification supports **incremental checkpoints**. If the provider implements `getLastChainCheckpoint()` and `saveChainCheckpoint()`, only events after the last checkpoint are verified. If the chain breaks at the checkpoint boundary (first event's `prev_hash` does not match the checkpoint hash), it falls back to full verification. Successful verification saves a new checkpoint containing `{lastEventId, lastEventHash, eventsVerified}`.

The return type is `ChainVerification`:

```typescript
interface ChainVerification {
  valid: boolean;
  total_checked: number;
  first_broken_at?: string;   // ISO timestamp
  broken_event_id?: string;
}
```

---

## Search Fallback Chain

`MemoryStore.search()` implements a three-tier fallback:

### Tier 1: Vector Search

If the embedding provider has `dimension > 0`, the query string is embedded and passed to `provider.vectorSearch()`. This performs cosine-similarity ranking against stored event embeddings, filtered by optional `event_type`, `severity`, `skill`, `since`, and `session_id` constraints. Results include a `score` field (0-1).

If embedding generation or vector search throws, execution falls through to Tier 2.

### Tier 2: Provider Text Search

If the provider implements the optional `textSearch()` method (e.g., SQLite `LIKE` or Supabase full-text search), the query is passed through. Results are returned with a flat `score: 1.0` since text search does not produce relevance scores.

### Tier 3: JavaScript Filtering

As a last resort, `search()` fetches recent events via `provider.query()` with the caller's filters and performs a case-insensitive substring match on `title` and `detail` in JavaScript. This is the least performant path and may miss older events outside the query's `limit`.

---

## Pruning

Pruning is handled by `provider.prune()` and configured via two parameters:

- `maxEvents`: Maximum total events to retain (default: 100,000).
- `maxAgeDays`: Delete events older than this many days (default: 365).

Auto-pruning runs during `initialize()` if `max_events` or `auto_prune_days` are set in configuration. Manual pruning is available via `store.prune()`.

---

## Provider Abstraction

The `StorageProvider` interface (defined in `providers/storage-provider.ts`) abstracts all persistence. Every provider must implement:

| Method | Purpose |
|--------|---------|
| `initialize()` / `close()` | Lifecycle |
| `insert(event)` | Store a single event |
| `getById(id)` | Retrieve by primary key |
| `query(options)` | Filtered listing with pagination |
| `count(options)` | Count matching events |
| `vectorSearch(embedding, options)` | Cosine-similarity search |
| `aggregate(options)` | Stats: counts by type, severity, skill |
| `getChain(since?)` | Ordered event list for chain verification |
| `prune(options)` | Delete old/excess events |

Optional methods: `textSearch()`, `saveChainCheckpoint()`, `getLastChainCheckpoint()`.

Each provider declares `mode: 'local' | 'remote'` to indicate its deployment model.

### Built-in Providers

**SqliteProvider** (`mode: 'local'`): Default. Uses a local SQLite database at a configurable path (default: `agent-sentry/data/ops.db`). The database path is resolved relative to the config file location via `resolveDatabasePath()`.

**SupabaseProvider** (`mode: 'remote'`): For team/shared environments. Configured via `supabase_url` and `supabase_service_role_key` in the config file, or via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables.

### Provider Selection

`createProvider()` in `provider-factory.ts` reads the `provider` field from configuration:

- `"sqlite"` -> `SqliteProvider`
- `"supabase"` -> `SupabaseProvider`
- Any other value (or missing) -> falls back to `SqliteProvider`

Configuration is loaded from a JSON file (resolved by `resolveConfigPath()`) under the `memory` key, merged with defaults:

```typescript
const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,
  provider: 'sqlite',
  embedding_provider: 'auto',
  database_path: 'agent-sentry/data/ops.db',
  max_events: 100000,
  auto_prune_days: 365,
};
```

---

## Embedding Providers

The `EmbeddingProvider` interface requires three members: `embed(text): Promise<number[]>`, `dimension: number`, and `name: string`.

### Auto-Detection Order

When `embedding_provider` is set to `"auto"` (the default), `detectEmbeddingProvider()` in `embeddings.ts` tries providers in this order:

1. **ONNX** (`onnx-local`, dimension 384): Checks if `onnxruntime-node` is resolvable. Uses `all-MiniLM-L6-v2` with download-on-first-use from HuggingFace. Runs entirely locally with no API calls. Includes a whitespace tokenizer with vocab lookup, mean pooling, and L2 normalization.

2. **Ollama** (`ollama`, dimension 384): Pings `http://127.0.0.1:11434/api/tags` with a 1-second timeout. Uses the `all-minilm` model via the `/api/embeddings` endpoint.

3. **OpenAI** (`openai`, dimension 384): Requires `OPENAI_API_KEY` in environment. Uses `text-embedding-3-small` with `dimensions: 384`.

4. **Voyage** (`voyage`, dimension 384): Requires `VOYAGE_API_KEY` in environment. Uses `voyage-3-lite` with `output_dimension: 384`.

5. **Noop** (`noop`, dimension 0): Returns empty arrays. Disables vector search; the search fallback chain proceeds to text search or JS filtering.

All providers output 384-dimensional vectors (except noop), ensuring embeddings are interchangeable across providers without re-indexing.

### Graceful Fallback

If auto-detection fails entirely during `MemoryStore.initialize()`, the store keeps the `NoopEmbeddingProvider` and logs a debug message. If a specific provider is requested but unavailable, `detectEmbeddingProvider()` throws -- callers that use `auto` never see an error.

If embedding generation fails for an individual `capture()` call, the event is stored without an embedding (the field is `undefined`) and a debug message is logged. The event remains searchable via text search.

---

## Event Enrichment

The `EventEnricher` class in `enrichment.ts` runs post-capture analysis on events. It accepts pluggable `EnrichmentProvider` instances; the default is `LocalPatternMatcher`.

`LocalPatternMatcher` provides four enrichment outputs:

- **Cross-tags**: Maps `affected_files` paths against regex patterns (e.g., files under `auth/` get tagged `authentication`, files under `db/` get `database`).
- **Root cause hints**: If 3+ recent events (from the past 7 days) share overlapping `affected_files` with the current event, a hint is emitted naming the most-common shared files.
- **Related events**: Scores recent events by file overlap (weight 2) and tag overlap (weight 1), returns top 5 IDs.
- **Severity context**: For high/critical events, checks the current git branch. Critical events on `main`/`master` get "immediate action required"; high events on feature branches note "mitigated by feature branch isolation".

Enrichment results are merged across all providers via `mergeResults()`, which unions tags and related events and takes the first non-null root cause hint and severity context.
