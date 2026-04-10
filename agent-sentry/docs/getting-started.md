# Getting Started with AgentSentry

## Installation

```bash
npm install @calabamatex/agentsentry
```

## Basic Usage

```typescript
import { MemoryStore, createProvider } from '@calabamatex/agentsentry';

// Create a store with the default SQLite provider
const store = new MemoryStore({
  provider: createProvider({ provider: 'sqlite', database_path: './ops.db' }),
});

await store.initialize();

// Capture an event
const event = await store.capture({
  timestamp: new Date().toISOString(),
  session_id: 'session-001',
  agent_id: 'agent-coder',
  event_type: 'decision',
  severity: 'low',
  skill: 'save_points',
  title: 'Created backup before refactor',
  detail: 'Git stash created prior to changing auth module',
  affected_files: ['src/auth/login.ts'],
  tags: ['backup', 'refactor'],
  metadata: { branch: 'feature/auth-rework' },
});

console.log('Captured event:', event.id);

// Search events by text query (uses vector search if an embedding provider is available)
const results = await store.search('auth refactor', { limit: 5 });
for (const { event, score } of results) {
  console.log(`[${score.toFixed(2)}] ${event.title}`);
}

// List events with filters
const incidents = await store.list({
  event_type: 'incident',
  severity: 'high',
  limit: 10,
});

// Get aggregate stats
const stats = await store.stats();
console.log(`Total events: ${stats.total_events}`);

// Verify hash chain integrity
const chain = await store.verifyChain();
console.log(`Chain valid: ${chain.valid} (${chain.total_checked} checked)`);

await store.close();
```

## Provider Configuration

AgentSentry reads configuration from `agent-sentry/agent-sentry.config.json`:

```json
{
  "memory": {
    "enabled": true,
    "provider": "sqlite",
    "embedding_provider": "auto",
    "database_path": "agent-sentry/data/ops.db",
    "max_events": 100000,
    "auto_prune_days": 365
  }
}
```

**Providers:**

| Provider | Use case | Config |
|----------|----------|--------|
| `sqlite` | Local development (default) | `database_path` |
| `supabase` | Cloud/team environments | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars |

**Embedding providers** (auto-detected in order):

1. `onnx` -- Local ONNX Runtime (384-dim, downloads model on first use)
2. `ollama` -- Local Ollama at `127.0.0.1:11434`
3. `openai` -- OpenAI `text-embedding-3-small` (requires `OPENAI_API_KEY`)
4. `voyage` -- Voyage AI `voyage-3-lite` (requires `VOYAGE_API_KEY`)
5. `noop` -- No embeddings (text-only search fallback)

## CLI Usage

```bash
# Capture an event
npx @calabamatex/agentsentry capture --type decision --severity low --title "Deployed v2"

# Search event history
npx @calabamatex/agentsentry search "authentication bug"

# List recent events
npx @calabamatex/agentsentry list --limit 20 --type incident

# Get stats
npx @calabamatex/agentsentry stats

# Verify chain integrity
npx @calabamatex/agentsentry verify

# Run health check
npx @calabamatex/agentsentry health

# Scan for secrets
npx @calabamatex/agentsentry scan --path src/

# Start MCP server
npx @calabamatex/agentsentry serve
```

## Dashboard

Start the built-in dashboard to get a live SSE event feed, health status, metrics, and plugin overview:

```typescript
import { DashboardServer } from '@calabamatex/agentsentry';

const dashboard = new DashboardServer({ port: 9200 });
const info = await dashboard.start();
console.log(`Dashboard running at ${info.url}`);
// Open http://127.0.0.1:9200 in your browser
```

Or from the CLI:

```bash
npx @calabamatex/agentsentry dashboard --port 9200
```

The dashboard exposes these endpoints:

| Path | Description |
|------|-------------|
| `/` | Interactive SPA dashboard |
| `/events` | SSE live event stream |
| `/api/health` | Health check readiness |
| `/api/metrics` | Prometheus text metrics |
| `/api/plugins` | Installed plugin list |
| `/api/stats` | Memory store statistics |

## Next Steps

- See the [API Reference](./api-reference.md) for the full public API
- Check `docs/examples/` for runnable code samples
- Read the [Plugin Tutorial](./plugin-tutorial.md) for building custom plugins

## Feature Maturity

| Feature                  | Status         | Notes                                    |
|--------------------------|----------------|------------------------------------------|
| SQLite memory store      | **Stable**     | Default provider, hash-chained, auto-pruning |
| MCP server (9 tools)     | **Stable**     | stdio + HTTP transport                   |
| Claude Code hooks        | **Stable**     | TypeScript implementations with shell wrappers |
| Progressive enablement   | **Stable**     | 5 levels                                 |
| CLI (8 commands)         | **Stable**     | health, memory, config, enable, plugin, metrics, stream, dashboard |
| Enrichment & observability | **Stable**   | Auto-classification, circuit breaker, structured logging |
| Supabase provider        | Beta           | Requires external Supabase instance      |
| Dashboard / streaming    | Beta           | Local SSE/WebSocket, in-process bus      |
| Cross-session intelligence | Beta         | Session summaries, pattern detection, context recall |
| Plugin registry          | Experimental   | Local directory scanning only            |
| Multi-agent coordination | Experimental   | Single-machine, event-sourced            |
