# AgentOps v4.0 — Phase 2+3 Handoff

## Session Context
**Date:** 2026-03-20
**Branch:** main
**Prior work:** Phase 1 complete (Persistent Memory Store) — 44 tests passing, build clean

## Build Plan Source
Full plan: `AgentSentry-OB1-Build-Plan.md` (repo root, Phases 2+3 start at line ~454)
Phase 1 handoff: `docs/AgentSentry-v4-Phase1-Handoff.md`
Product spec: `AgentSentry-Product-Spec.md` (repo root)

## Phase 1 Completed Assets

### Source Files (`agent-sentry/src/memory/`)
| File | Purpose |
|------|---------|
| `schema.ts` | `OpsEvent` interface, `EventType`, `Severity`, `Skill` types, `computeHash()`, `validateEventInput()` |
| `store.ts` | `MemoryStore` class — `capture()`, `search()`, `list()`, `stats()`, `verifyChain()` |
| `embeddings.ts` | `EmbeddingProvider` interface + ONNX, Ollama, OpenAI, Noop providers |
| `providers/storage-provider.ts` | `StorageProvider` interface |
| `providers/sqlite-provider.ts` | Full SQLite backend (CRUD, vector search, aggregation, chain) |
| `providers/supabase-provider.ts` | Stub — throws `NotImplementedError` |
| `providers/provider-factory.ts` | Config-driven provider selection |
| `migrations/sqlite-migrations.ts` | Schema creation + versioning |
| `event-subscriber.ts` | Subscribes to `event-bus.ts`, routes events to `capture()` |
| `cli-capture.js` | CLI entry for shell hook integration |
| `index.ts` | Public API exports |

### Config
`agent-sentry/agentops.config.json` has a `memory` section:
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

### Tests (44 passing)
```
tests/memory/store.test.ts              — 10 tests (CRUD, hash chain, pagination, search, stats)
tests/memory/embeddings.test.ts         — 4 tests  (noop provider, detection)
tests/memory/search.test.ts             — 6 tests  (text search, filters, no-match)
tests/memory/providers/sqlite-provider.test.ts  — 8 tests
tests/memory/providers/provider-factory.test.ts — 3 tests
tests/memory/providers/provider-parity.test.ts  — 7 tests (supabase stub)
tests/memory/migrations/sqlite-migrations.test.ts — 4 tests
tests/memory/integration.test.ts        — 2 tests  (full lifecycle, chain recovery)
```

### Key Interfaces Phase 2+3 Should Use
```typescript
import { MemoryStore } from '../memory/store';
import { OpsEvent, OpsEventInput, EventType, Severity, Skill } from '../memory/schema';
import { SearchResult, OpsStats, ChainVerification } from '../memory/schema';
```

---

## Phase 2: MCP Server (can run in parallel with Phase 3)

### Goal
Expose AgentOps as an MCP server so Claude Code, Cursor, and other AI clients can query the management layer.

### File Tree to Build
```
agent-sentry/src/mcp/
├── server.ts              # MCP server setup, tool registration
├── tools/
│   ├── check-git.ts       # agentops_check_git
│   ├── check-context.ts   # agentops_check_context
│   ├── check-rules.ts     # agentops_check_rules
│   ├── size-task.ts       # agentops_size_task
│   ├── scan-security.ts   # agentops_scan_security
│   ├── capture-event.ts   # agentops_capture_event (wraps MemoryStore.capture())
│   ├── search-history.ts  # agentops_search_history (wraps MemoryStore.search())
│   └── health.ts          # agentops_health (wraps MemoryStore.stats())
├── transport.ts           # Stdio + HTTP transport
└── auth.ts                # Access key validation (HTTP only)
```

### 8 MCP Tools
| Tool | Input | Wraps |
|------|-------|-------|
| `agentops_check_git` | none | Shell: `scripts/git-hygiene-check.sh` |
| `agentops_check_context` | `message_count?` | Shell: `scripts/context-estimator.sh` |
| `agentops_check_rules` | `file_path`, `change_description` | Shell: `scripts/rules-file-linter.sh` |
| `agentops_size_task` | `task`, `files?` | Shell: `scripts/task-sizer.sh` |
| `agentops_scan_security` | `content`, `file_path?` | Shell: `scripts/security-audit.sh` |
| `agentops_capture_event` | `event_type`, `severity`, `skill`, `title`, `detail`, `affected_files?`, `tags?` | `MemoryStore.capture()` |
| `agentops_search_history` | `query`, `limit?`, `event_type?`, `severity?`, `since?` | `MemoryStore.search()` |
| `agentops_health` | none | `MemoryStore.stats()` |

### Transport
- **Stdio** (default): `node agent-sentry/dist/src/mcp/server.js`
- **HTTP** (optional): `node agent-sentry/dist/src/mcp/server.js --http --port 3100` with `x-agentops-key` header
- Integration: `claude mcp add agentops -- node agent-sentry/dist/src/mcp/server.js`

### Security
- HTTP transport requires access key (generated on install, stored in `.env`)
- Stdio inherits process-level permissions
- All inputs validated via zod schemas
- Rate limiting on HTTP (100 req/min)
- No raw database access exposed

### Tests to Write
```
agent-sentry/tests/mcp/
├── server.test.ts         # Tool registration, request routing
├── tools/*.test.ts        # Each tool unit-tested
├── transport.test.ts      # Stdio and HTTP transport
├── auth.test.ts           # Key validation, rate limiting
└── integration.test.ts    # Full MCP client → server round-trip
```

### Dependencies to Add
- `@modelcontextprotocol/sdk` (MCP SDK)
- `zod` (schema validation)

### Verification
```bash
cd agentops && npm test -- --grep "mcp"
cd agentops && npm run build
claude mcp add agentops -- node agent-sentry/dist/src/mcp/server.js
```

---

## Phase 3: Primitives & Plugin Model (can run in parallel with Phase 2)

### Goal
Extract shared patterns from the 17 shell scripts into composable TypeScript primitives. Formalize plugin contribution model.

### File Tree to Build
```
agent-sentry/src/primitives/
├── checkpoint-and-branch.ts    # Used by: Skills 1, 4
├── rules-validation.ts         # Used by: Skills 3, 5
├── risk-scoring.ts             # Used by: Skills 4, 5
├── context-estimation.ts       # Used by: Skills 2, 4
├── scaffold-update.ts          # Used by: Skills 2, 3
├── secret-detection.ts         # Used by: Skills 1, 5
├── event-capture.ts            # Used by: All skills (wraps MemoryStore.capture())
└── index.ts                    # Public API
```

### 7 Primitives (each exports a typed interface)
| Primitive | Key Export | Used By Skills |
|-----------|-----------|----------------|
| `checkpoint-and-branch` | `createCheckpoint()`, `createSafetyBranch()` | 1 (Save Points), 4 (Small Bets) |
| `rules-validation` | `validateRules()`, `RuleViolation` | 3 (Standing Orders), 5 (Proactive Safety) |
| `risk-scoring` | `assessRisk()`, `RiskAssessment`, `RiskFactor` | 4 (Small Bets), 5 (Proactive Safety) |
| `context-estimation` | `estimateContext()`, `ContextHealth` | 2 (Context Health), 4 (Small Bets) |
| `scaffold-update` | `updateScaffold()` | 2 (Context Health), 3 (Standing Orders) |
| `secret-detection` | `scanForSecrets()`, `SecretFinding` | 1 (Save Points), 5 (Proactive Safety) |
| `event-capture` | `captureEvent()` (wraps MemoryStore) | All skills |

### Plugin Model
```
agent-sentry/plugins/
├── _templates/
│   ├── monitor/     # metadata.json, README.md, src/index.ts
│   ├── auditor/
│   ├── dashboard/
│   └── integration/
├── core/            # Bundled plugins
└── community/       # User-installed plugins (already exists)
```

### Plugin Metadata Schema (`config/plugin.schema.json`)
Required fields: `name`, `description`, `category` (monitor|auditor|dashboard|integration), `author`, `version`, `requires`, `tags`

### Plugin Validation Script (`scripts/validate-plugin.sh`)
11 checks:
1. Folder structure matches category template
2. metadata.json validates against schema
3. No secrets in any file
4. README has required sections
5. src/index.ts exports valid plugin interface
6. Hook subscriptions reference valid types
7. MCP tool names follow convention
8. No files exceed 500 lines
9. Required primitives exist
10. Tests exist and pass
11. No binary files >1MB

### Tests to Write
```
agent-sentry/tests/primitives/
├── checkpoint-and-branch.test.ts
├── rules-validation.test.ts
├── risk-scoring.test.ts
├── context-estimation.test.ts
├── scaffold-update.test.ts
├── secret-detection.test.ts
├── event-capture.test.ts
└── integration.test.ts

agent-sentry/tests/plugins/
├── validation.test.ts
├── metadata-schema.test.ts
└── template.test.ts
```

### Verification
```bash
cd agentops && npm test -- --grep "primitives"
cd agentops && npm test -- --grep "plugin"
cd agentops && npm run build
bash scripts/validate-plugin.sh plugins/_templates/monitor
```

---

## Do NOT Change
- `agent-sentry/audit/audit-logger.ts`
- `agent-sentry/core/event-bus.ts`
- `agent-sentry/tracing/trace-context.ts`
- Any Phase 1 file in `agent-sentry/src/memory/` (consume, don't modify)

## Parallel Execution Notes
- Phase 2 and Phase 3 have **no shared files** — they can run in separate sessions or as parallel agents
- Both depend on Phase 1's `MemoryStore` API (read-only dependency)
- Phase 4 requires both Phase 2 and Phase 3 complete
- If running as a swarm: use `hierarchical` topology, one agent per phase, shared memory namespace `agentops-build`

## After Phase 2+3
Phase 4 (Progressive Enablement + Auto-Classification) is detailed in `AgentSentry-OB1-Build-Plan.md` starting at line ~781. It requires both Phases 2 and 3 complete.
