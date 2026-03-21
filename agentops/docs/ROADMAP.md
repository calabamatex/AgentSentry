# AgentOps Roadmap

## Now — Stable

Production-ready features. Fully tested, documented, and supported.

| Feature | Description |
|---------|-------------|
| SQLite Memory Store | Hash-chained event store with vector search support |
| MCP Server (9 tools) | stdio/HTTP transport, all tools documented |
| Claude Code Hooks | Session start, post-write, checkpoint hooks |
| Progressive Enablement | 5 levels of incremental skill activation |
| CLI (9 commands) | health, metrics, memory, stream, plugin, config, dashboard, enable |
| Enrichment | Auto-classification, cross-tagging, root cause hints |
| Observability | Health checks, circuit breaker, structured logging, metrics |

## Next — Beta

Actively being hardened. Functional but may have rough edges.

| Feature | Description | Target |
|---------|-------------|--------|
| Supabase Provider | Remote storage via Supabase | API stable, needs prod testing |
| Dashboard / Streaming | Local SSE/WebSocket event dashboard | Backpressure and limits being added |
| Cross-Session Intelligence | Session summaries, pattern detection, context recall | Core logic complete |
| Auto-Handoff Messages | Generate handoff messages on context overflow | Hook integration pending |
| CLI `enable` command | Interactive onboarding flow | Telemetry being added |

## Later — Experimental

Proof-of-concept features. Single-machine, no production guarantees.

| Feature | Description | Status |
|---------|-------------|--------|
| Multi-Agent Coordination | Event-sourced locks, leases, messaging | Single-machine only |
| Plugin Registry | Local directory scanning for plugins | No remote discovery |
| Organization Memory | Shared team-level patterns and decisions | Design phase only |
| Distributed Streaming | Durable transport (Redis/NATS) | ADR written, not started |

---

**Principle**: We ship features that work, clearly label features that don't yet,
and never market experimental as production-ready.
