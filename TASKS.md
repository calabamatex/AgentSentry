# AgentOps — Task Tracker

## Completed (v4.0)

- [x] Phase 1: Persistent Memory Store
- [x] Phase 2: MCP Server Interface
- [x] Phase 3: Primitives & Plugin Model
- [x] Phase 4: Progressive Enablement & Enrichment
- [x] P0: Auto-pruning, vector search optimization, chain checkpoints
- [x] Tier 1: Package portability, build health, version sync
- [x] Tier 2: Rules unification, health enrichment, doc corrections
- [x] Tier 3: Scaffold docs, first real plugin

## Completed (M3 — Adoption Polish)

- [x] CI build matrix (Linux + macOS)
- [x] Install smoke test (7/7 pass)
- [x] Dashboard v4 (plugins, enablement levels, enrichment panels)
- [x] E2E plugin tutorial
- [x] ONNX model to Git LFS (86MB → tracked)
- [x] Dry-run/confirm mode for auto-checkpoint hooks
- [x] RuFlo enforcement hook + CLAUDE.md rule

## Completed (M4 — Cloud & Scale)

- [x] Supabase storage provider `[beta]` — full CRUD, vector search, chain checkpoints via raw HTTPS; needs production validation
- [x] Multi-agent coordination primitives `[experimental]` — single-machine, event-sourced, no consensus protocol
- [x] Plugin registry `[experimental]` — local directory scanning only, no remote discovery
- [x] Real-time event streaming `[beta]` — local SSE/WebSocket transport with backpressure (ADR-001)

## Open (M5 — Hardening)

- [ ] Cloud LLM enrichment provider (Ollama/OpenAI)
- [ ] Supabase provider production validation (load testing, error recovery)
- [ ] Remote plugin discovery and trust model
- [ ] Distributed streaming transport (Redis/NATS) — pending demand signal
