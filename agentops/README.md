# AgentSentry v4.0

Your AI agents forget everything between sessions. AgentSentry fixes that.

It catches secrets before they're committed, warns when context is running low, scores the risk of proposed changes, and remembers what happened across sessions — so you don't have to re-explain context every time you start a new conversation.

No external services required. Install in 60 seconds. Works out of the box.

## Quick Start

```bash
# 1. Install dependencies
cd agent-sentry && npm install

# 2. Build
npm run build

# 3. Wire as MCP server in Claude Code
claude mcp add agent-sentry -- node dist/src/mcp/server.js

# 4. Verify
claude mcp list
```

That's it. SQLite storage and noop embeddings work out of the box — no API keys or external services needed.

## What You Get

| Layer | What it does |
|-------|-------------|
| **Memory Store** | Hash-chained event storage with auto-pruning, incremental chain verification, and chunked vector search |
| **MCP Server** | 9 tools exposed via Model Context Protocol (stdio + HTTP) |
| **Primitives** | 7 composable modules — risk scoring, rules validation, secret scanning, context health, git checks, task sizing, file analysis |
| **Enablement Engine** | 5 progressive levels from Safe Ground to Full Guard |
| **Enrichment** | Auto-classification by domain (auth, db, api, testing, config, infra) with root-cause detection |
| **Intelligence** | Cross-session summaries, pattern detection, and context recall |
| **Audit Index** | Full-text search over events, file audit trails, session timelines |
| **Plugin System** | JSON Schema-validated plugins with 11-check validation script |

## Feature Maturity

| Feature | Status | Notes |
|---------|--------|-------|
| SQLite memory store | **Stable** | Default provider, hash-chained, auto-pruning |
| MCP server (9 tools) | **Stable** | stdio + HTTP transport |
| Claude Code hooks | **Stable** | TypeScript implementations with shell wrappers |
| Progressive enablement | **Stable** | 5 levels |
| CLI (8 commands) | **Stable** | health, memory, config, enable, plugin, metrics, stream, dashboard |
| Enrichment & observability | **Stable** | Auto-classification, circuit breaker, structured logging |
| Supabase provider | **Beta** | Requires external Supabase instance |
| Dashboard / streaming | **Beta** | Local SSE/WebSocket, in-process bus |
| Cross-session intelligence | **Beta** | Session summaries, pattern detection, context recall |
| Plugin registry | Experimental | Local directory scanning only |
| Multi-agent coordination | Experimental | Event-sourced, single-machine only |

## MCP Tools

Once wired, these tools are available in any Claude Code session:

| Tool | Purpose |
|------|---------|
| `agent_sentry_health` | Store stats, chain integrity, embedding state, enablement level |
| `agent_sentry_capture_event` | Log a hash-chained event (decision, error, tool_use, etc.) |
| `agent_sentry_check_rules` | Validate a file change against CLAUDE.md/AGENTS.md rules |
| `agent_sentry_check_context` | Estimate context window usage |
| `agentops_size_task` | Score risk of a proposed change (LOW/MEDIUM/HIGH/CRITICAL) |
| `agentops_search_history` | Search the event audit trail |
| `agentops_scan_security` | Detect secrets in file content |
| `agentops_check_git` | Git status and hygiene checks |
| `agentops_recall_context` | Cross-session context recall for current task |

## Progressive Enablement

AgentOps ships at **Level 2 (Clear Head)** by default — session checkpoints and context health monitoring are active out of the box. This gives you meaningful safety without configuration overhead.

If you want to customize, adjust `enablement.level` in `agentops.config.json`:

| Level | Name | What's active |
|-------|------|--------------|
| 1 | Safe Ground | save_points (full) |
| 2 | **Clear Head** (default) | + context_health (full) |
| 3 | House Rules | + standing_orders (basic) |
| 4 | Right Size | standing_orders→full, + small_bets (basic) |
| 5 | Full Guard | small_bets→full, + proactive_safety (full) |

## Storage

- **Default**: SQLite (local, zero-config)
- **Embeddings**: ONNX all-MiniLM-L6-v2 (384 dimensions) — falls back to noop if model unavailable
- **Supabase** [beta]: Remote PostgreSQL via Supabase REST API — set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

Auto-pruning keeps the database bounded — configure `max_events` and `max_age_days` in `agentops.config.json`.

## Development

```bash
npm run build          # TypeScript compilation
npm test               # All 1098 tests via vitest
npm run test:unit      # Source-only unit tests (no build required)
npm run test:contracts # Build artifact validation (requires npm run build first)
npm run test:e2e       # End-to-end integration tests
npm run test:perf      # Performance benchmarks
npm run test:watch     # Watch mode
npm run benchmark      # Run performance benchmarks
```

## Project Structure

> **npm package scope:** The published npm package ships `dist/src/` (runtime core) and `agentops.config.json`. Shell scripts (`scripts/`), plugin templates (`plugins/`), and documentation (`docs/`) are available in the source repository.

```
src/
  memory/       # Store, schema, providers, migrations, enrichment, intelligence, audit
  mcp/          # MCP server + 9 tool handlers
  cli/          # CLI commands, TypeScript hook handlers
  primitives/   # 7 reusable management patterns
  enablement/   # Progressive enablement engine
  analyzers/    # Error handling & PII detection analyzers
  coordination/ # Multi-agent coordination [experimental]
  streaming/    # SSE/WebSocket event transport [beta]
  dashboard/    # Single-file HTML monitoring dashboard [beta]
  observability/ # Logger, circuit breaker, health, metrics, shutdown
  plugins/      # Plugin registry
scripts/        # Thin shell wrappers for hooks
tests/          # Mirror of src/ structure + e2e + performance
docs/           # Getting started, API reference, schema, roadmap
```

## Documentation

- [First Session Walkthrough](docs/first-session.md) — See AgentOps in action with concrete examples
- [Getting Started](docs/getting-started.md) — Install and first audit
- [API Reference](docs/api-reference.md) — Every module and method
- [Memory Schema](docs/memory-schema.md) — Event schema for building integrations
- [Plugin Tutorial](docs/plugin-tutorial.md) — Build custom plugins
- [Roadmap](docs/ROADMAP.md) — Feature maturity and planned work

### Architecture

- [Memory Model](docs/architecture/memory-model.md) — Hash-chained storage, search, and providers
- [Enablement Model](docs/architecture/enablement-model.md) — The 5-level progressive system
- [MCP Integration](docs/architecture/mcp-integration.md) — Tools, transports, and auth

## Disabling or Removing AgentOps

AgentOps is additive — it does not modify your source code or project files. When `save_points.auto_commit_enabled` is `true` (the default), AgentOps creates git stash snapshots as safety checkpoints. These are non-destructive and do not alter your commit history. Set `auto_commit_enabled` to `false` in `agentops.config.json` to disable stash snapshots entirely.

**Disable temporarily:** Set `"enabled": false` in the `memory` section of `agentops.config.json`. All hooks become no-ops. Your data is preserved.

**Remove completely:**

```bash
claude mcp remove agentops        # Unwire the MCP server
rm -rf agentops/data/             # Delete the SQLite database (optional)
```

Your code, git history, and Claude Code configuration are unchanged.

## License

See repository root.
