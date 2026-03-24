# AgentSentry Roadmap

## Now — Stable

Production-ready features. Fully tested, documented, and supported.

| Feature | Description |
|---------|-------------|
| SQLite Memory Store | Hash-chained event store with vector search support |
| MCP Server (9 tools) | stdio/HTTP transport, all tools documented |
| Claude Code Hooks | TypeScript implementations with shell wrappers for backward compat |
| Progressive Enablement | 5 levels of incremental skill activation |
| CLI (11 commands) | health, metrics, memory, stream, plugin, config, dashboard, enable, prune, export, import |
| Enrichment | Auto-classification, cross-tagging, root cause hints |
| Observability | Health checks, circuit breaker, structured logging, metrics |
| Performance Benchmarks | CI-integrated regression tests with threshold enforcement |

## Next — Beta

Actively being hardened. Functional but may have rough edges.

| Feature | Description | Target |
|---------|-------------|--------|
| Supabase Provider | Remote storage via Supabase REST API | Smoke-tested, needs prod validation |
| Dashboard / Streaming | Local SSE/WebSocket event dashboard | Backpressure and limits in place |
| Cross-Session Intelligence | Session summaries, pattern detection, context recall | Core logic complete |
| Auto-Handoff Messages | Generate handoff messages on context overflow | Hook integration pending |
| CLI `enable` command | Interactive onboarding flow | Telemetry being added |

## Later — Experimental

Proof-of-concept features. Single-machine, no production guarantees.

| Feature | Description | Status |
|---------|-------------|--------|
| Multi-Agent Coordination | Atomic locks (SQLite CAS), leases with fencing tokens, messaging | Single-machine, atomic lock support added |
| Plugin Registry | Local directory scanning for plugins | No remote discovery |
| Organization Memory | Shared team-level patterns and decisions | Design phase only |
| Distributed Streaming | Durable transport (Redis/NATS) | ADR written, not started |

---

## Future Considerations

### Multi-Tenancy

AgentSentry currently uses a single database per deployment. For multi-project isolation:
- **Recommended now**: Use separate database files per project via `memory.database_path` in `agent-sentry.config.json`
- **Future**: Add a `namespace` column to `ops_events` for logical isolation within a single database

### Stdio MCP Security Model

The stdio MCP transport is inherently authenticated by process-level access control — only the parent process can write to stdin. For shared or networked deployments, use the HTTP transport with `AGENT_SENTRY_ACCESS_KEY` for access-key authentication and per-IP rate limiting.

---

**Principle**: We ship features that work, clearly label features that don't yet,
and never market experimental as production-ready.
