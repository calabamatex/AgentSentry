# AgentSentry v4.1.0 -- Comprehensive SDLC Analysis Report

**Date**: 2026-03-29
**Repository**: calabamatex/AgentSentry
**Methodology**: 7-agent parallel analysis via RuFlo swarm orchestration
**Agents**: System Architect, Security Auditor, Code Analyzer, Tester, Performance Engineer, CI/CD Engineer, Researcher

---

## Executive Summary

AgentSentry is a well-engineered memory-aware management and safety framework for AI agents. The codebase demonstrates strong fundamentals: clean DAG architecture with 14 bounded contexts, zero circular dependencies, zero `any` types, minimal runtime dependencies (4), and 1,129 tests with a 97.7% pass rate.

**However**, the analysis identified **76 actionable findings** across all SDLC dimensions:

| Severity | Count | Top Concerns |
|----------|-------|-------------|
| **Critical** | 1 | Startup loads entire events table into memory |
| **High** | 10 | Auth bypass, PostgREST injection, O(n) vector search, unused query optimizer, no SQLite busy_timeout |
| **Medium** | 25 | Cache invalidation, secret scanner gaps, dashboard auth, DRY violations, missing tests |
| **Low** | 28 | Deprecated APIs, ESLint gaps, env var docs, Docker support |
| **Advisory/Info** | 12 | Positive findings, minor inconsistencies |

**Overall Maturity Score: 7.4/10** -- Production-capable for solo/small-team use; needs hardening for multi-user or cloud deployments.

---

## 1. Architecture (Score: 8/10)

### Strengths
- Clean layered architecture: Presentation (CLI/MCP/Dashboard) -> Application (Coordination/Streaming) -> Domain (Memory/Enablement) -> Infrastructure (Providers/Embeddings)
- No circular dependencies -- import graph is a strict DAG
- 14 well-defined bounded contexts with ~16,168 LOC across ~90 TypeScript files
- Minimal dependency footprint: 4 runtime deps (`@modelcontextprotocol/sdk`, `better-sqlite3`, `uuid`, `zod`)
- Well-implemented design patterns: Event Sourcing, Provider, Factory, Circuit Breaker, Decorator (Caching), Observer/Pub-Sub, Hash Chain

### Key Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| A1 | **High** | O(n) linear vector search bounded at 10K embeddings with no ANN/HNSW transition path | `sqlite-provider.ts:138-208` |
| A2 | **High** | Coordination layer full-scans 500-1000 events per operation with client-side dedup | `coordinator.ts:149-191`, `lease.ts:185-220` |
| A3 | **High** | ONNX model download has no SHA-256 checksum verification | `embeddings.ts:148-184` |
| A4 | **Medium** | Event-sourced coordination without compaction -- ~2,880 heartbeat events/agent/day | `coordinator.ts`, `lease.ts` |
| A5 | **Medium** | QueryOptimizer and PreparedStatementCache exist but are never wired into SqliteProvider | `query-optimizer.ts` |
| A6 | **Medium** | batchInsert has no transaction wrapping -- N separate disk syncs instead of 1 | `batch.ts:127-134` |
| A7 | **Medium** | Hash chain race condition between getLatestHash() and insert() under concurrent writes | `store.ts:93-129` |
| A8 | **Medium** | Rate limiter defined but unclear if wired to MCP HTTP transport | `auth.ts`, `server.ts` |
| A9 | **Low** | Dashboard server.ts has widest fan-out (7 modules) -- God module risk | `dashboard/server.ts` |
| A10 | **Low** | Plugin validation uses manual type checking instead of Zod (inconsistent) | `registry.ts:328-401` |

---

## 2. Security (Score: 6.5/10)

### Strengths
- SQLite uses fully parameterized queries throughout -- no SQL injection risk
- Timing-safe comparison for access key via `crypto.timingSafeEqual()`
- Rate limiter with DoS protection (MAX_STORE_SIZE = 10000)
- `execFileSync` with argument arrays in security-critical paths
- Hash chain audit trail is cryptographically sound (SHA-256)
- Zod schema validation on all MCP tool inputs
- WebSocket 1MB buffer limit prevents memory exhaustion
- Zero `eval()` or `new Function()` usage

### Key Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| S1 | **High** | Auth bypass when AGENT_SENTRY_ACCESS_KEY is unset -- open-by-default | `auth.ts:13-16` |
| S2 | **High** | PostgREST filter injection via unsanitized event_type, severity, tag params | `supabase-base.ts:329-339` |
| S3 | **Medium** | Dashboard and WebSocket servers have zero authentication | `dashboard/server.ts`, `ws-transport.ts` |
| S4 | **Medium** | Secret detection patterns inconsistent across 3 scanners (TS, shell, MCP tool) | `secret-detection.ts`, `secret-scanner.sh`, `scan-security.ts` |
| S5 | **Medium** | PII scanner covers only 8 patterns -- missing address, DOB, IP, financial, biometric | `pii-scanner.ts:24-33` |
| S6 | **Medium** | Audit trail has no external signature (HMAC) -- rewritable with valid hashes | `audit/audit-logger.ts` |
| S7 | **Medium** | Permission enforcer fails open (exit 0) when jq/node missing | `permission-enforcer.sh:40-46` |
| S8 | **Medium** | Access key accepted via URL query parameter -- leaks to logs/history | `transport.ts:70-71` |
| S9 | **Medium** | validateEventInput does not validate enum membership | `schema.ts:106-119` |
| S10 | **Low** | 8 npm audit vulns (all devDependencies -- vite, brace-expansion) | `package.json` |
| S11 | **Low** | execSync with string commands in 3 hook files instead of execFileSync | `session-checkpoint.ts:83`, `post-write.ts:109` |
| S12 | **Low** | No input length limits on MCP tool Zod schemas | `src/mcp/tools/*.ts` |
| S13 | **Low** | CORS wildcard (*) when no access key configured | `transport.ts:55` |
| S14 | **Low** | UUID filterValidIds() is a no-op in supabase-base.ts | `supabase-base.ts:251-253` |

---

## 3. Code Quality (Score: 7.5/10)

### Strengths
- **Zero `any` types** -- exceptional TypeScript discipline
- **Zero TODO/FIXME/HACK** comments -- completed, not deferred
- `strict: true` in tsconfig.json
- Consistent structured logging (no raw `console.log`)
- Clean barrel exports with explicit `export type` syntax
- All files under 500 lines (max 475)
- Circuit breaker with injectable sleep for testability
- Minimal runtime dependencies (4)

### Key Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| Q1 | **Medium** | 22 `as unknown as` type assertions bypass type safety | `coordinator.ts:163,382`, `intelligence.ts:154,253` |
| Q2 | **Medium** | DRY violation: `e instanceof Error ? e.message : String(e)` repeated 95 times | 44 files across `src/` |
| Q3 | **Medium** | 3 HTTP embedding providers share ~35 lines identical boilerplate each | `embeddings.ts:272-387` |
| Q4 | **Medium** | Dashboard html.ts has 260+ lines untyped/untestable inline JavaScript | `dashboard/html.ts` |
| Q5 | **Medium** | 3 files at 475-line boundary (sqlite-provider, coordinator, registry) | Various |
| Q6 | **Low** | `new Date().toISOString()` repeated 54 times -- no injectable Clock | 28 files |
| Q7 | **Low** | `Buffer.slice()` deprecated in Node 18+ -- use `subarray()` | `ws-transport.ts:227,340-351` |
| Q8 | **Low** | ESLint missing `no-floating-promises` and `no-misused-promises` rules | `eslint.config.mjs` |
| Q9 | **Low** | `cleanExpiredLocks()` is a documented no-op that returns 0 | `coordinator.ts:332-336` |
| Q10 | **Low** | `getAgent()` calls `listAgents()` (scans 500 events) to find one agent | `coordinator.ts:193-196` |

### Top Refactoring Opportunities
1. Extract `errorMessage(e: unknown): string` utility -- eliminates 95 duplicates (~1 hour)
2. Extract `HttpEmbeddingProvider` base class -- consolidates 3 providers (~2 hours)
3. Enable `@typescript-eslint/no-floating-promises` -- catches real async bugs (~30 min)
4. Externalize dashboard JavaScript -- makes it lintable and testable (~3-4 hours)

---

## 4. Testing (Score: 7.5/10)

### Strengths
- 1,129 tests across 91 files (97.7% pass rate)
- Healthy test pyramid: ~65 unit, ~12 integration, 5 E2E, 3 contract, 1 performance
- Proper lifecycle management (beforeEach/afterEach with cleanup)
- Factory helpers for test data (makeEvent, makeOpsEvent, makeBreaker)
- Contract tests catch real drift bugs (version, config, build artifacts)
- Supabase tests conditionally skip with `describe.skipIf`

### Key Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| T1 | **Medium** | 15 non-trivial src modules have NO dedicated test file | See list below |
| T2 | **Medium** | No coverage configuration in vitest -- no thresholds, no provider, no reports | `vitest.config.ts` |
| T3 | **Medium** | Build-dependent tests (contracts, E2E) fail without prior `npm run build` | `build-contracts.test.ts`, `install-and-run.test.ts` |
| T4 | **Low** | No concurrent write contention tests for SQLite WAL mode | Missing |
| T5 | **Low** | No migration path tests for v3 and v4 upgrades | `migration-v3.ts`, `migration-v4.ts` |
| T6 | **Low** | Performance thresholds are 10x baseline -- catches catastrophic only | `benchmark-regression.test.ts` |
| T7 | **Low** | No CLI workflow E2E (init -> capture -> search -> export) | Missing |

**15 Untested Modules**: `config/resolve.ts`, `cli/commands/export.ts`, `cli/commands/import.ts`, `cli/commands/prune.ts`, `cli/commands/handoff-templates.ts`, `cli/commands/init-wizard.ts`, `cli/hooks/cost-tracker.ts`, `coordination/coordinator-tasks.ts`, `coordination/lease.ts`, `core/event-bus.ts`, `mcp/shared-store.ts`, `memory/event-subscriber.ts`, `memory/migrations/migration-v3.ts`, `memory/migrations/migration-v4.ts`, `observability/log-forwarder.ts`

---

## 5. Performance (Score: 6.5/10)

### Strengths
- WAL journal mode with `synchronous = NORMAL` for SQLite
- Connection pooling with keep-alive for Supabase
- Chunked vector search (1000/chunk) prevents memory spikes
- Circuit breaker with exponential backoff + jitter
- Streaming with backpressure (100-event queue cap per client)
- WebSocket 1MB pending buffer cap

### Key Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| P1 | **Critical** | `getChain()` loads ENTIRE events table on startup | `store.ts:62` |
| P2 | **High** | QueryOptimizer composite indexes + PreparedStatementCache never wired up | `sqlite-provider.ts:58-68` |
| P3 | **High** | No `busy_timeout` pragma -- concurrent writes get immediate SQLITE_BUSY | `sqlite-provider.ts:64` |
| P4 | **High** | Cache invalidation too aggressive -- every insert clears ALL query/count/aggregate caches | `cache.ts:253-259` |
| P5 | **High** | No embedding cache -- identical queries re-embed every time (5-200ms each) | `embeddings.ts` |
| P6 | **High** | O(n) vector search with no ANN indexing | `sqlite-provider.ts:138-208` |
| P7 | **High** | Supabase aggregate fires ~19+ sequential HTTP requests (N+1 pattern) | `supabase-base.ts:145-184` |
| P8 | **Medium** | No transaction wrapping on event+embedding insert | `sqlite-provider.ts:80-109` |
| P9 | **Medium** | LIKE '%query%' text search forces full table scan (no FTS5) | `sqlite-provider.ts:330` |
| P10 | **Medium** | Ollama health check adds 1s to startup when not running | `embeddings.ts:262-269` |
| P11 | **Medium** | Barrel index.ts eagerly exports everything -- no tree-shaking | `index.ts` |

---

## 6. DevOps & CI/CD (Score: 7/10)

### Strengths
- Multi-version Node.js CI matrix (18, 20, 22)
- Smoke-test-install validates published package artifact
- Pre-commit hook scans for 6+ secret token pattern families
- Production-grade `hook-guard.sh` with circuit breaker, debounce, reentrance detection
- Full `ShutdownManager` with priority-ordered handlers and timeout budgets
- Git LFS for ONNX model files
- Release metadata sync tooling

### Key Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| D1 | **High** | No CI concurrency control -- duplicate runs waste resources | `ci.yml` |
| D2 | **High** | `sync-metadata:check` and `config-validator.sh` not wired into CI | Various |
| D3 | **High** | No npm provenance (`--provenance`) on publish | `publish.yml` |
| D4 | **Medium** | No code coverage collection or reporting | `vitest.config.ts`, `ci.yml` |
| D5 | **Medium** | No `npm audit` or Dependabot/Renovate for dependency scanning | Missing |
| D6 | **Medium** | `stat -c %Y` in hook-guard.sh is Linux-only (breaks macOS) | `hook-guard.sh` |
| D7 | **Medium** | No `prepare` script to auto-configure git hooks path | `package.json` |
| D8 | **Medium** | No version-tag consistency check in publish workflow | `publish.yml` |
| D9 | **Medium** | SIGTERM not handled in MCP HTTP mode (only SIGINT) | `server.ts` |
| D10 | **Low** | No ShellCheck CI step for 23 bash scripts | Missing |
| D11 | **Low** | No `exports` field in package.json for ESM subpath imports | `package.json` |
| D12 | **Low** | No Docker/container support | Missing |

---

## 7. Documentation (Score: 7/10, Coverage: 82%)

### Strengths
- README: Clear value proposition, 3 install options, progressive enablement table
- API Reference: Comprehensive coverage of all public surfaces with types
- Architecture Docs: Memory model, enablement model, MCP integration -- all excellent
- Getting Started + First Session: Actionable, scenario-driven guides
- Templates: Well-structured CONTEXT.md, PLANNING.md, TASKS.md, WORKFLOW.md

### Key Findings

| ID | Severity | Finding | Location |
|----|----------|---------|----------|
| DOC1 | **High** | Tool naming inconsistency: `agentops_` vs `agent_sentry_` prefix | `quick-start.md`, `tutorial.md` |
| DOC2 | **High** | 10th MCP tool (`generate-handoff`) undocumented everywhere | README, API ref, MCP integration doc |
| DOC3 | **Medium** | `directive_compliance` (6th skill) exists in code but undocumented | `engine.ts:25` |
| DOC4 | **Medium** | Product name split: "AgentOps" in planning docs, "AgentSentry" in code | All planning docs |
| DOC5 | **Medium** | CLI command lists differ across README (8), getting-started (~10), ROADMAP (11) | Various |
| DOC6 | **Medium** | No migration guide, troubleshooting/FAQ, or CHANGELOG | Missing |
| DOC7 | **Low** | Genesis prev_hash described as "empty string" in memory-schema.md (code uses `'0'.repeat(64)`) | `memory-schema.md` |
| DOC8 | **Low** | AGENTS.md is thin (30 lines) with no AgentSentry-specific rules | `AGENTS.md` |
| DOC9 | **Low** | No CONTRIBUTING.md, SECURITY.md, or root config JSON Schema | Missing |
| DOC10 | **Low** | Many config keys undocumented (notifications, security.suppressions, etc.) | README |

---

## Cross-Cutting: Top 15 Priority Actions

### Critical (Fix Immediately)
| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 1 | **P1**: Replace `getChain()` with `getLatestHash()` on startup | Prevents loading entire DB into memory | 30 min |

### High (Fix This Sprint)
| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 2 | **S1**: Require explicit opt-in to disable auth (log WARNING when key unset) | Prevents accidental unauthenticated exposure | 1 hr |
| 3 | **S2**: Apply `encodeURIComponent()` to all PostgREST filter values | Prevents filter injection on Supabase path | 2 hr |
| 4 | **P3**: Add `db.pragma('busy_timeout = 5000')` | Prevents SQLITE_BUSY failures under concurrency | 15 min |
| 5 | **P2**: Wire QueryOptimizer into SqliteProvider.initialize() | Enables composite indexes + prepared statement cache | 2 hr |
| 6 | **P4**: Replace aggressive cache invalidation with tag-based partial invalidation | Dramatically improves mixed read/write cache hit rate | 3 hr |
| 7 | **P5**: Add LRU embedding cache keyed on text hash | Eliminates redundant 5-200ms embedding calls | 2 hr |
| 8 | **A3**: Add SHA-256 checksum verification for ONNX model download | Prevents supply chain attack via malicious model | 1 hr |
| 9 | **DOC1/DOC2**: Fix tool naming consistency + document generate-handoff | Prevents user confusion | 2 hr |
| 10 | **D3**: Add `--provenance` to npm publish | Supply chain security best practice | 30 min |

### Medium (Fix This Quarter)
| # | Finding | Impact | Effort |
|---|---------|--------|--------|
| 11 | **S4**: Consolidate secret detection patterns into single source | Eliminates scanner coverage gaps | 4 hr |
| 12 | **T2**: Add vitest coverage configuration with 80% threshold | Enables coverage tracking and gates | 2 hr |
| 13 | **Q2**: Extract `errorMessage()` utility | Eliminates 95 DRY violations | 1 hr |
| 14 | **D4**: Add coverage collection and Codecov upload to CI | Visible coverage metrics | 2 hr |
| 15 | **T1**: Add tests for 15 uncovered modules | Closes critical coverage gaps | 8 hr |

---

## Appendix: Agent Execution Metrics

| Agent | Duration | Tool Calls | Files Read | Tokens |
|-------|----------|------------|------------|--------|
| Architecture | 185s | 40 | ~25 | 93K |
| Security | 183s | 52 | ~30 | 116K |
| Code Quality | 131s | 36 | ~20 | 85K |
| Testing | 221s | 30 | ~40 | 49K |
| Performance | 145s | 26 | ~18 | 87K |
| DevOps/CI | 179s | 53 | ~25 | 48K |
| Documentation | 154s | 45 | ~30 | 77K |
| **Total** | **~3.3 min wall** | **282** | **~188** | **555K** |

All 7 agents ran concurrently. Wall-clock time was bounded by the slowest agent (Testing at 221s).

---

*Report generated by RuFlo SDLC swarm -- 7 specialized agents analyzing calabamatex/AgentSentry in parallel.*
