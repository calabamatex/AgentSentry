# AgentOps v4.0

Memory-aware agent management for Claude Code. Captures every agent action as a hash-chained, searchable event — giving you a tamper-evident audit trail, risk scoring, and progressive safety controls.

## Quick Start

```bash
# 1. Install dependencies
cd agentops && npm install

# 2. Build
npm run build

# 3. Wire as MCP server in Claude Code
claude mcp add agentops -- node dist/src/mcp/server.js

# 4. Verify
claude mcp list
```

That's it. SQLite storage and noop embeddings work out of the box — no API keys or external services needed.

## What You Get

| Layer | What it does |
|-------|-------------|
| **Memory Store** | Hash-chained event storage with auto-pruning, incremental chain verification, and chunked vector search |
| **MCP Server** | 8 tools exposed via Model Context Protocol (stdio + HTTP) |
| **Primitives** | 7 composable modules — risk scoring, rules validation, secret scanning, context health, git checks, task sizing, file analysis |
| **Enablement Engine** | 5 progressive levels from Safe Ground to Full Guard |
| **Enrichment** | Auto-classification by domain (auth, db, api, testing, config, infra) with root-cause detection |
| **Audit Index** | Full-text search over events, file audit trails, session timelines |
| **Plugin System** | JSON Schema-validated plugins with 11-check validation script |

## MCP Tools

Once wired, these tools are available in any Claude Code session:

| Tool | Purpose |
|------|---------|
| `agentops_health` | Store stats, chain integrity, embedding state, enablement level |
| `agentops_capture_event` | Log a hash-chained event (decision, error, tool_use, etc.) |
| `agentops_check_rules` | Validate a file change against CLAUDE.md/AGENTS.md rules |
| `agentops_check_context` | Estimate context window usage |
| `agentops_size_task` | Score risk of a proposed change (LOW/MEDIUM/HIGH/CRITICAL) |
| `agentops_search_history` | Search the event audit trail |
| `agentops_scan_security` | Detect secrets in file content |
| `agentops_check_git` | Git status and hygiene checks |

## Progressive Enablement

| Level | Name | What's active |
|-------|------|--------------|
| 1 | Safe Ground | Save points only |
| 2 | Guarded Start | + context health, standing orders |
| 3 | Guided Flow | + risk scoring, rules checking (default) |
| 4 | Full Assist | + enrichment, audit search, plugins |
| 5 | Full Guard | All features, strict mode |

## Storage

- **Default**: SQLite (local, zero-config)
- **Embeddings**: ONNX all-MiniLM-L6-v2 (384 dimensions) — falls back to noop if model unavailable
- **Supabase**: Planned for a future release (provider interface exists, not yet implemented)

Auto-pruning keeps the database bounded — configure `max_events` and `max_age_days` in `agentops.config.json`.

## Development

```bash
npm run build     # TypeScript compilation
npm test          # 427 tests via vitest
npm run test:watch # Watch mode
```

## Project Structure

```
src/
  memory/       # Store, schema, providers, migrations, enrichment, audit
  mcp/          # MCP server + 8 tool handlers
  primitives/   # Risk scoring, rules, secrets, context, git, sizing, files
  enablement/   # Progressive enablement engine
plugins/        # Plugin system (core/commit-monitor included)
scripts/        # Shell hooks + validation utilities
tests/          # Mirror of src/ structure
docs/           # Quick-start, API reference, handoff docs
```

## Documentation

- [Quick Start](../docs/quick-start.md) — Install and first audit in 10 minutes
- [API Reference](../docs/api-reference.md) — Every script, command, and module
- [Product Spec](../AgentOps-Product-Spec.md) — Full v4.0 specification

## License

See repository root.
