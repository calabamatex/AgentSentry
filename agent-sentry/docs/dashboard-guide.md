# Dashboard Guide

AgentSentry includes a built-in monitoring dashboard served over HTTP with no external dependencies.

**Status:** Beta

## Quick Start

```bash
npx @calabamatex/agentsentry dashboard
```

Opens a browser to `http://127.0.0.1:9200` with the single-page dashboard.

### Options

```bash
npx @calabamatex/agentsentry dashboard --port 9300    # Custom port
npx @calabamatex/agentsentry dashboard --host 0.0.0.0 # Listen on all interfaces
```

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
| `eventStream` | EventStream | new instance | Event stream to subscribe to |
| `healthChecker` | HealthChecker | new instance | Health checker for /api/health |
| `pluginRegistry` | PluginRegistry | new instance | Plugin registry for /api/plugins |
| `memoryStore` | MemoryStore | undefined | Memory store for /api/stats |
| `enablementConfig` | EnablementConfig | undefined | Enablement config for /api/enablement |
| `coordinator` | AgentCoordinator | undefined | Coordinator for /api/coordination |

## CLI Streaming

For terminal-based monitoring without the dashboard:

```bash
npx @calabamatex/agentsentry stream
```

This streams events to stdout in real-time.

## Static Dashboard

A standalone HTML file is also available at `agent-sentry/dashboard/agent-sentry-dashboard.html`. Open it directly in a browser — no server required (data will be static).

```bash
open agent-sentry/dashboard/agent-sentry-dashboard.html
```
