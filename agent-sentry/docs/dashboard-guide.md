# Dashboard Guide

AgentSentry includes a built-in monitoring dashboard served over HTTP with no external dependencies.

**Status:** Beta

## Quick Start

```bash
# Authentication is required (0.6.0+). Either set a token…
AGENT_SENTRY_DASHBOARD_TOKEN=<your-token> npx @calabamatex/agentsentry dashboard

# …or let --dev auto-generate one (printed at startup; development only)
npx @calabamatex/agentsentry dashboard --dev
```

Opens a browser to `http://127.0.0.1:9200` with the single-page dashboard.

### Options

```bash
npx @calabamatex/agentsentry dashboard --port 9300    # Custom port
npx @calabamatex/agentsentry dashboard --host 0.0.0.0 # Listen on all interfaces
npx @calabamatex/agentsentry dashboard --dev          # Auto-generate an auth token (dev only)
```

## Authentication

The dashboard **fails closed**: it refuses to start without an auth token, matching
the MCP server's require-auth-by-default posture.

| Mechanism | Use |
|-----------|-----|
| `AGENT_SENTRY_DASHBOARD_TOKEN` env var | Production — takes precedence over everything |
| `token` option (programmatic) | Embedding the server in your own process |
| `--dev` flag / `devMode: true` | Development — auto-generates a random token, printed by the CLI |
| `AGENT_SENTRY_NO_AUTH=1` | Disables auth entirely (**unsafe**; logged as a warning at startup) |

Requests authenticate with `Authorization: Bearer <token>`. All comparisons are
constant-time (`crypto.timingSafeEqual` via a comparator shared with the MCP auth layer).

### SSE query-parameter token — known exposure

`EventSource` cannot set request headers, so SSE connections to `/events` may pass
the token as a query parameter (`/events?token=<token>`). **Trade-off to understand:**
URLs can be recorded in places headers are not — browser history, proxy/access logs,
and `Referer` headers. Mitigations in place and recommended:

- The server never writes the token to its own logs (startup logs record only `auth: token|disabled`).
- The dashboard binds `127.0.0.1` by default — the URL never crosses a network unless you change `--host`.
- If you bind a non-loopback host, front the dashboard with TLS and prefer header auth for everything except the SSE connection.
- A short-lived derived session token for SSE is planned (see WI-105 in `docs/remediation-plan.md`).

## Endpoints

| Path | Description |
|------|-------------|
| `/` | Dashboard HTML (single-page app) |
| `/events` | SSE event stream (real-time) |
| `/api/health` | Health check (memory, event loop) |
| `/api/metrics` | Prometheus-format metrics |
| `/api/plugins` | Installed plugins list |
| `/api/stats` | Memory store statistics |
| `/api/enablement` | Current enablement level and active skills |
| `/api/streaming` | Stream statistics (clients, events published) |
| `/api/coordination` | Agent coordination status (experimental) |
| `/api/risk` | Confidence-labeled risk score for the current session (Level 6 only; returns `{ available: false }` otherwise) |

## Real-Time Event Stream

The `/events` endpoint provides Server-Sent Events (SSE). Connect from a browser or CLI:

```bash
curl -N http://127.0.0.1:9200/events
```

### Filtering

Filter the event stream with query parameters:

```
/events?type=violation,incident        # By event type
/events?severity=high,critical         # By severity
/events?skill=save_points              # By skill
/events?agent=agent-coder              # By agent ID
/events?session=session-001            # By session ID
```

Multiple filters can be combined.

## Programmatic Usage

```typescript
import { DashboardServer, EventStream, MemoryStore, createProvider } from '@calabamatex/agentsentry';

const store = new MemoryStore({
  provider: createProvider({ provider: 'sqlite', database_path: './ops.db' }),
});
await store.initialize();

const dashboard = new DashboardServer({
  port: 9200,
  host: '127.0.0.1',
  token: process.env.DASHBOARD_TOKEN, // required — constructor throws without one
  memoryStore: store,
  eventStream: new EventStream(),
});

const info = await dashboard.start();
console.log(`Dashboard running at ${info.url}`);

// Later:
await dashboard.stop();
```

### DashboardServerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | 9200 | Port to listen on |
| `host` | string | '127.0.0.1' | Host to bind to |
| `corsOrigin` | string | 'http://127.0.0.1:9200' | CORS allowed origin |
| `token` | string | — | Auth token (required unless `devMode` or `AGENT_SENTRY_NO_AUTH`); `AGENT_SENTRY_DASHBOARD_TOKEN` overrides |
| `devMode` | boolean | false | Auto-generate a token when none configured (dev only; retrieve via `getToken()`) |
| `eventStream` | EventStream | new instance | Event stream to subscribe to |
| `healthChecker` | HealthChecker | new instance | Health checker for /api/health |
| `pluginRegistry` | PluginRegistry | new instance | Plugin registry for /api/plugins |
| `memoryStore` | MemoryStore | undefined | Memory store for /api/stats and /api/risk |
| `enablementConfig` | EnablementConfig | undefined | Enablement config for /api/enablement; gates /api/risk to Level 6 |
| `coordinator` | AgentCoordinator | undefined | Coordinator for /api/coordination |

## CLI Streaming

For terminal-based monitoring without the dashboard:

```bash
npx @calabamatex/agentsentry stream
```

This streams events to stdout in real-time.

## Static Dashboard

Removed in 0.6.0-beta.2 — the unreferenced static HTML snapshot drifted from the live dashboard (`src/dashboard/html.ts` is authoritative). Use `agentsentry dashboard` instead.
