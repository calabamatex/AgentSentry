# AgentOps Memory Schema

> Public contract for the AgentOps event schema. Use this reference when building integrations, custom providers, or querying the memory store directly.

## OpsEvent

Every record in the AgentOps memory store is an `OpsEvent`. Events are hash-chained for tamper detection.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | auto | UUID v4, generated on capture |
| `timestamp` | `string` | yes | ISO 8601 datetime (e.g. `2026-03-22T14:30:00.000Z`) |
| `session_id` | `string` | yes | Identifies the coding session |
| `agent_id` | `string` | yes | Identifies the agent that produced the event |
| `event_type` | `EventType` | yes | One of the event type enum values (see below) |
| `severity` | `Severity` | yes | One of the severity enum values (see below) |
| `skill` | `Skill` | yes | Which AgentOps skill produced the event (see below) |
| `title` | `string` | yes | Short summary, max 120 characters |
| `detail` | `string` | yes | Full description of the event |
| `affected_files` | `string[]` | yes | List of file paths affected by this event |
| `tags` | `string[]` | yes | Freeform tags for filtering |
| `metadata` | `object` | yes | Arbitrary key-value data (JSON object) |
| `embedding` | `number[]` | no | Vector embedding for semantic search (auto-generated if embeddings enabled) |
| `hash` | `string` | auto | SHA-256 hash of the event content + `prev_hash` |
| `prev_hash` | `string` | auto | Hash of the previous event in the chain |

## Enums

### EventType

| Value | Description |
|-------|-------------|
| `decision` | A decision made during the session (e.g. architecture choice) |
| `violation` | A rule or convention violation detected |
| `incident` | An error, failure, or unexpected behavior |
| `pattern` | A recurring pattern observed across sessions |
| `handoff` | Session handoff context for cross-session continuity |
| `audit_finding` | Result of an automated audit or scan |

### Severity

| Value | Description |
|-------|-------------|
| `low` | Informational, no action required |
| `medium` | Worth reviewing, may need action |
| `high` | Should be addressed soon |
| `critical` | Requires immediate attention |

### Skill

| Value | Description |
|-------|-------------|
| `save_points` | Auto-checkpoint and blast radius tracking |
| `context_health` | Context window monitoring and estimation |
| `standing_orders` | Rules file validation and enforcement |
| `small_bets` | Task sizing and incremental delivery |
| `proactive_safety` | Security scanning and PII detection |
| `system` | Internal system events |

## OpsEventInput

When creating events via the `MemoryStore.capture()` method, provide an `OpsEventInput` — the same shape as `OpsEvent` but without `id`, `hash`, `prev_hash`, and `embedding` (these are generated automatically).

```typescript
type OpsEventInput = Omit<OpsEvent, 'id' | 'hash' | 'prev_hash' | 'embedding'>;
```

## QueryOptions

Used with `MemoryStore.query()` to filter events.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | `100` | Max events to return |
| `offset` | `number` | `0` | Pagination offset |
| `event_type` | `EventType` | — | Filter by event type |
| `severity` | `Severity` | — | Filter by severity |
| `skill` | `Skill` | — | Filter by skill |
| `since` | `string` | — | ISO 8601 lower bound (inclusive) |
| `until` | `string` | — | ISO 8601 upper bound (inclusive) |
| `session_id` | `string` | — | Filter by session |
| `agent_id` | `string` | — | Filter by agent |
| `tag` | `string` | — | Filter by tag (matches if tag is in the array) |

## VectorSearchOptions

Used with `MemoryStore.search()` for semantic search.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | `number` | `10` | Max results to return |
| `threshold` | `number` | `0.5` | Minimum similarity score (0–1) |
| `event_type` | `EventType` | — | Filter by event type |
| `severity` | `Severity` | — | Filter by severity |
| `skill` | `Skill` | — | Filter by skill |
| `since` | `string` | — | ISO 8601 lower bound |
| `session_id` | `string` | — | Filter by session |

## Hash Chain

Events are hash-chained for tamper detection. Each event's `hash` is computed as:

```
SHA-256(JSON.stringify({
  id, timestamp, session_id, agent_id, event_type, severity,
  skill, title, detail, affected_files, tags, metadata, prev_hash
}))
```

The first event in the chain uses an empty string as `prev_hash`. Chain integrity can be verified with `MemoryStore.verifyChain()`.

## Storage Providers

The schema is provider-agnostic. Currently supported providers:

| Provider | Status | Description |
|----------|--------|-------------|
| SQLite | **Stable** | Default. Local file-based storage with hash-chaining |
| Supabase | **Beta** | Remote PostgreSQL via Supabase REST API |

### Building a Custom Provider

Implement the `StorageProvider` interface from `src/memory/providers/storage-provider.ts`:

```typescript
interface StorageProvider {
  readonly name: string;
  readonly mode: 'local' | 'remote';
  initialize(): Promise<void>;
  close(): Promise<void>;
  insert(event: OpsEvent): Promise<void>;
  getById(id: string): Promise<OpsEvent | null>;
  query(options: QueryOptions): Promise<OpsEvent[]>;
  count(options: QueryOptions): Promise<number>;
  vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]>;
  aggregate(options: AggregateOptions): Promise<OpsStats>;
  getChain(since?: string): Promise<OpsEvent[]>;
  prune(options: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }>;
  saveChainCheckpoint(checkpoint: ChainCheckpoint): Promise<void>;
  getLastChainCheckpoint(): Promise<ChainCheckpoint | null>;
}
```

Register custom providers with the `ProviderFactory` before initializing the store.
