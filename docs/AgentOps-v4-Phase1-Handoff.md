# AgentOps v4.0 — Phase 1 Handoff

## Session Context
**Date:** 2026-03-20
**Branch:** main
**Prior work:** v0.2 complete (6 clean commits), v0.3 wiring done (cost-tracker, lifecycle-manager, plugin-loader)

## Build Plan Source
Full plan: `AgentOps-OB1-Build-Plan.md` (repo root)
Product spec: `AgentOps-Product-Spec.md` (repo root)
OB1 analysis: `AgentOps-OB1-Analysis.md` (repo root)

## Decisions Made (This Session)

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Bootstrap TS project** inside `agent-sentry/` | No `package.json` or `tsconfig.json` exists yet. Need `src/` tree. |
| 2 | **Subscribe to event-bus, don't modify it** | `event-bus.ts`, `audit-logger.ts`, `trace-context.ts` are frozen (do not change). Memory capture adds a new subscriber module. |
| 3 | **ONNX model: download-on-first-use (Option B)** | Keeps repo small. Model cached to `agent-sentry/models/` on first `search()` call. No 23MB binary in git. |
| 4 | **Stub Supabase, implement SQLite only** | Supabase needs env vars to test. Build the `StorageProvider` interface + SQLite provider. Supabase provider is a stub returning `NotImplementedError`. |
| 5 | **Phase 1 only this cycle** | Context limits. Phases 2-4 deferred to subsequent sessions. |
| 6 | **Spec at repo root** | `AgentOps-Product-Spec.md` is at `/AgentOps-Product-Spec.md`, not in `docs/`. |

## What to Build (Phase 1: Persistent Memory Store)

### 1. Bootstrap TypeScript Project
- Create `agent-sentry/package.json` with dependencies: `better-sqlite3`, `onnxruntime-node`, `uuid`
- Create `agent-sentry/tsconfig.json` targeting ES2020
- Add `npm run build` and `npm test` scripts

### 2. Memory Store Core — File Tree
```
agent-sentry/src/memory/
├── store.ts                    # MemoryStore class — CRUD + vector search
├── schema.ts                   # OpsEvent interface, EventType, Severity, Skill types
├── embeddings.ts               # EmbeddingProvider interface + download-on-first-use ONNX
├── providers/
│   ├── storage-provider.ts     # StorageProvider interface
│   ├── sqlite-provider.ts      # SQLite + sqlite-vec implementation
│   ├── supabase-provider.ts    # STUB only — throws NotImplementedError
│   └── provider-factory.ts     # Auto-detect: config → env → default(sqlite)
├── migrations/
│   └── sqlite-migrations.ts    # Schema creation + versioning
├── event-subscriber.ts         # NEW — subscribes to event-bus.ts, calls capture()
├── cli-capture.js              # CLI entry for shell hook integration
└── index.ts                    # Public API exports
```

### 3. Key Interfaces (from build plan)
- `OpsEvent` — id, timestamp, session_id, agent_id, event_type, severity, skill, title, detail, affected_files, tags, metadata, embedding, hash, prev_hash
- `StorageProvider` — initialize(), close(), insert(), getById(), query(), count(), vectorSearch(), aggregate(), getChain()
- `MemoryStore` — capture(), search(), list(), stats(), verifyChain()
- `EmbeddingProvider` — embed(), dimension, name

### 4. Embedding Provider Priority
1. Local ONNX model (`all-MiniLM-L6-v2`) — downloaded on first use to `agent-sentry/models/`
2. Ollama local API (if running)
3. OpenAI API (if `OPENAI_API_KEY` set)
4. No-op provider (structured queries only, no semantic search)

### 5. Hook Integration
Every existing shell script in `agent-sentry/scripts/` gets a `capture_event` call appended. Uses `cli-capture.js` to write to memory store. Does NOT modify `event-bus.ts`.

### 6. Config Update
Add `memory` section to `agent-sentry/agentops.config.json`:
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

### 7. Tests (TDD London School)
```
agent-sentry/tests/memory/
├── store.test.ts               # CRUD, hash chain, pagination
├── embeddings.test.ts          # Provider detection, fallback chain
├── search.test.ts              # Semantic + filtered search
├── providers/
│   ├── sqlite-provider.test.ts
│   ├── provider-factory.test.ts
│   └── provider-parity.test.ts # Runs against SQLite (Supabase skipped until implemented)
├── migrations/
│   └── sqlite-migrations.test.ts
└── integration.test.ts         # Full capture → search → verify
```

### 8. Phase 1 Verification Gate
```bash
cd agentops && npm test -- --grep "memory"
cd agentops && npm test -- --grep "embedding"
cd agentops && npm test -- --grep "chain"
cd agentops && npm run build
```

## Do NOT Change
- `agent-sentry/audit/audit-logger.ts`
- `agent-sentry/core/event-bus.ts`
- `agent-sentry/tracing/trace-context.ts`

## Existing Assets (Reference Only)
- 17 shell scripts in `agent-sentry/scripts/`
- 10 eval suites in `agent-sentry/evals/`
- `agent-sentry/plugins/plugin-loader.sh` + `community/` dir
- `agent-sentry/dashboard/` — HTML dashboard with data files
- `agent-sentry/agentops.config.json` — current config (no `memory` section yet)

## After Phase 1
Phases 2-4 are detailed in `AgentOps-OB1-Build-Plan.md`:
- **Phase 2:** MCP Server (8 tools, stdio + HTTP transport)
- **Phase 3:** Primitives library + Plugin contribution model
- **Phase 4:** Progressive enablement (5 levels) + auto-classification enrichment

Phases 2+3 can run in parallel. Phase 4 requires all prior phases.
