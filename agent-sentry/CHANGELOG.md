# Changelog

All notable changes to AgentSentry are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Versioning history:** tags `v4.0.0` and `v4.1.0-beta` predate the deliberate
> 4.x → 0.x version reset (the AgentOps-era numbering) and do not correspond to
> npm releases of this package. They are scheduled for removal from the remote;
> their commits remain in history. Canonical versioning starts at `0.6.0-beta.1`.

## [Unreleased]

> **Upgrading from 0.5.x?** See [docs/migration-0.5-to-0.6.md](docs/migration-0.5-to-0.6.md) for the auth-required breaking changes (MCP HTTP + dashboard) and the step-by-step checklist.

### Added

- **Context-aware risk scoring (enablement Level 6 "Risk Watch") — [experimental].** A new 6th progressive level activates a deterministic, **confidence-labeled** risk-scoring engine. Reachable via the new `agent_sentry_risk_score` MCP tool (now **11 tools** total), gated to Level 6. Components: in-memory `SessionTopology`, a 5-rule compound-risk correlator, 5 behavioral misbehavior profiles, and a calibration harness (Brier score / reliability diagram) with a gate that enforces honest labeling. Every scored number carries a `Confidence { value, basis, sample_size }`; scores stay `default_priors` (heuristic, capped at 0.5) until labeled outcomes pass the calibration gate. Forward "trajectory/Monte-Carlo" prediction is deliberately deferred (`projectTrajectory()` returns "not available") rather than shipped uncalibrated. Additive `migration-v5` adds four tables; zero behavioral change at Levels 1–5. See `docs/architecture/risk-scoring.md`.
- **Rule-based pattern catalog** populates `active_threats` with **context-adjusted severity** — e.g. a secret detected in a test fixture is downgraded 0.85 → 0.17 via context modifiers.
- **Dashboard "Risk Watch" panel** (Level 6): the live dashboard adds an `/api/risk` endpoint and a panel showing the composite risk level + trend, a confidence badge (`default priors` vs `calibrated`), and compound risks / active threats / misbehavior profiles.
- **`agent_sentry_scan_security` probabilistic mode**: an opt-in `probabilistic: true` parameter enriches each finding with a context-adjusted severity and a heuristic false-positive estimate (e.g. a secret in a test/fixture file is downgraded), labeled `default_priors`. Default off — output unchanged otherwise.
- **`agent_sentry_health` risk summary**: at Level 6, health output gains a `risk_assessment` block (composite level, trend, confidence basis, active-threat/profile counts, top compound risk). Absent below Level 6.

### Fixed

- `npm run benchmark` no longer dirties the committed `benchmarks/baseline.json` (WI-023): results now go to a gitignored `benchmarks/results-<timestamp>.json` by default; `--update-baseline` deliberately refreshes the tracked reference run (which is informational and embeds its capture platform — the regression test uses hardcoded catastrophe thresholds, not this file).
- SQLite durability is now documented and configurable (WI-011): `AGENT_SENTRY_SQLITE_SYNCHRONOUS` selects `NORMAL` (default) or `FULL`; the trade-off (small power-loss window under NORMAL, detectable via hash-chain verification; prevented by FULL) is documented in `docs/architecture/memory-model.md`. Fixed a latent bug where `QueryOptimizer.optimizeConnection` unconditionally reset `synchronous` to `NORMAL`, silently clobbering a `FULL` choice.
- MCP rate limiting is now proxy- and multi-tenant-aware (WI-010): authenticated requests are bucketed per access key (SHA-256), so distinct keys behind one NAT/proxy IP get independent budgets; unauthenticated requests bucket by IP. `AGENT_SENTRY_TRUST_PROXY=1` opts into keying on the first `X-Forwarded-For` hop (ignored by default so the header can't be forged to spoof buckets). Documented in `docs/configuration.md`.
- Event enrichment no longer discards all providers' output when one throws (WI-009): the multi-provider fan-out now uses `Promise.allSettled`, merges the fulfilled results, and logs each rejection with its provider index. The remaining `Promise.all` sites (batch search/list public API, benchmark harness, Supabase aggregate counts) are genuinely all-or-nothing and now carry justification comments.
- Default enablement level unified at **2 (Clear Head)**: `health.ts` silently fell back to level 3 when no config was readable, contradicting the shipped config, README, and package docs. All fallbacks now use the exported `DEFAULT_ENABLEMENT_LEVEL` constant; `enablement-model.md` §Default Level Rationale corrected (said 3); a contract test pins constant = shipped config = documented default.
- `getNextLevel()` intent made explicit: Level 6 (Risk Watch, [experimental]) is **never auto-suggested** — the suggestion ceiling is a named constant (`MAX_AUTO_SUGGEST_LEVEL = 5`), test-pinned and documented; reaching L6 requires explicit opt-in.
- `bin/agent-sentry.sh` reported a hardcoded `v4.0.0` (AgentOps-era) against the `0.6.0-beta` package; it now resolves its version from `package.json` at runtime. A contract test and `sync-metadata:check` guard against reintroducing a hardcoded literal.
- De-flaked timing-sensitive tests: coordinator heartbeat/lock tests now poll instead of fixed sleeps; pooled-supabase request timing uses `performance.now()` (sub-millisecond); a mock-server socket leak in the provider tests; the `enforcement-evasion` ReDoS test asserts completion-with-correct-verdict rather than a wall-clock bound.
- Documentation honesty: README H1 version synced to `package.json`; MCP tool count (now 11) and enablement level count (now 6) corrected across README, ROADMAP, getting-started, api-reference, configuration, and the architecture docs; de-hyped pre-1.0 "production-ready" language.
- Strengthened over-mocked boundary tests (`recall-context`, `capture-event`) to drive a real in-memory store.

### Security

- ReDoS audit of all 28 secret/PII/injection detection patterns (WI-007): two SQL-injection patterns had unbounded `.*?` gaps that backtracked ~840ms on 500 KB of adversarial input — rewritten with delimiter-excluding bounded runs (`[^$\n]{0,500}` / `[^+\n]{0,500}`), now < 7 ms at the 1 MB cap with identical detection. Added `tests/security/redos.test.ts` (static `recheck` analysis hard-failing on exponential complexity + an authoritative timing gate running every pattern against 1 MB of structure-targeted adversarial input) and a `MAX_SCAN_BYTES` (1 MB) input cap applied in both the secret scanner and the `scan_security` tool (result flags `truncated`).
- Unicode evasion hardening (WI-014): the enforcement matcher and secret scanner now normalize inputs (NFKC + zero-width + bidi-control stripping via shared `src/utils/unicode-normalize.ts`) before matching — zero-width splices inside keywords (`de​lete`, `AKIA​…`), fullwidth Latin, NFD decompositions, and RTL-override wrapping no longer bypass ASCII-authored patterns. Attack tests confirm 6 previously-successful evasions are now caught; normalization is an identity on plain ASCII (test-pinned), so existing detections are unchanged.
- ONNX downloader hardened against teardown races (WI-008): downloads now use `stream.pipeline` (an error tears down response, cap-guard, and file streams together), write to a random temp name, and rename into place **only after** the SHA-256 check passes — a crash, mid-stream abort, over-cap response, or checksum mismatch can no longer leave a partial/unverified file where the loader would trust it. Previously a mid-stream response error could hang the download promise forever and strand a partial file at the destination.
- **BREAKING: dashboard authentication now fails closed** (parity with the MCP server). `DashboardServer` refuses to start without a token — set `AGENT_SENTRY_DASHBOARD_TOKEN`, pass `{ token }`, use the new CLI `--dev` flag to auto-generate one, or set `AGENT_SENTRY_NO_AUTH=1` (unsafe; warned at startup). Token comparisons (bearer and SSE query-param) are now constant-time via a comparator shared with the MCP auth layer (`src/utils/timing-safe.ts`), and the token no longer appears in server logs. The SSE query-param exposure trade-off is documented in `docs/dashboard-guide.md`.
- Re-enabled ONNX model/tokenizer **download integrity verification** (pinned SHA-256 checksums; previously skipped via empty constants) and added a download size cap.
- MCP HTTP transport now **fails closed**: non-health requests always validate via `validateAccessKey`; `/health` is an unauthenticated liveness probe; the server refuses keyless HTTP unless `AGENT_SENTRY_NO_AUTH` and binds loopback when keyless; wildcard CORS refused unless explicitly opted in.
- Added a project-root **path-traversal guard** to the rules checker; cleared both production-tree `high` npm advisories (`fast-uri`, `hono`); `.gitignore` now excludes `.env*`.
- Labeled the unused authority-enforcement engine `@experimental` (defined and tested, not yet wired into the decision path).
- npm publishes now carry a **provenance attestation** (`npm publish --provenance` with OIDC `id-token: write`), and the publish job is gated behind the `npm-publish` GitHub environment so required reviewers can be enforced. Migrating to npm Trusted Publishing (removing the stored `NPM_TOKEN`) is a pending owner action.

### Changed

- Repository purge (WI-015): removed non-project artifacts from version control — `website/` (only daemon logs), the stub root `package-lock.json`, 268 files of generic `.claude/` scaffolding + `.mcp.json` (now gitignored; regenerate locally, see CONTRIBUTING.md), the unreferenced static `agent-sentry-dashboard.html` snapshot (`src/dashboard/html.ts` is authoritative), and the git-LFS pointer for `models/all-MiniLM-L6-v2.onnx` (the runtime downloads and SHA-256-verifies the model on first use; `tokenizer.json` remains shipped). Docs that referenced the static dashboard now point at `agentsentry dashboard`.
- Corrected the coordinator's concurrency documentation (WI-025): the module header flatly claimed "No CAS — race conditions possible", but the default SQLite path uses true atomic compare-and-swap (`INSERT OR IGNORE` + fencing token) — proven by the existing contended-race test. The header and README capability row now honestly describe both tiers (atomic by default; event-sourced best-effort fallback only when no atomic-capable provider is wired). No code change — documentation was understating the implementation.
- Removed dead AgentOps-era duplicate modules `core/`, `audit/`, `tracing/` (outside `src/`, imported by nothing, yet compiled into `dist/`); `tsconfig.json` now includes only `src/**`. The divergent stray `core/event-bus.ts` contained no behavior missing from `src/core/event-bus.ts`.
- CI tarball smoke test now performs **real end-to-end calls**: `agentsentry init` + `health --json` (asserting exit 0 and a `status` key) and a live MCP stdio round-trip (`initialize` → `tools/list` → `agent_sentry_check_context`) via `scripts/mcp-smoke.cjs` — a packed artifact with a broken CLI or MCP surface now fails CI.
- All 18 ESLint warnings cleared (unused imports, `any` types, `require()` imports, misused-promise signal handlers, dead `readMemoryFiles`); `lint` now runs `--max-warnings 0` so warnings are CI-blocking.
- CI coverage thresholds added to `vitest.config.ts` (matching the CI gate); stopped tracking generated `coverage/` artifacts.
- `docs/remediation-plan.md` replaced with the v1.2 agent-executable workplan (supersedes the completed phased plan; its open Phase-6 items were ported as WI-025/WI-026/WI-103 — nothing dropped; prior implementation notes remain in git history).

## [0.6.0-beta.1] - 2026-04-11

### Breaking Changes

- **MCP authentication required by default.** The MCP server now rejects unauthenticated requests unless `AGENT_SENTRY_ACCESS_KEY` is set. For local development, set `AGENT_SENTRY_NO_AUTH=true` (emits a stderr warning on every startup). The deprecated `AGENT_SENTRY_REQUIRE_AUTH` environment variable has been removed.

### Security

- **Complete safe-primitive migration.** Every `JSON.parse` call in `src/` now routes through `safeJsonParse` (duplicate-key rejection, prototype-pollution guard). Every unprotected `fs.writeFileSync` call now routes through `atomicWriteSync` (symlink guard, crash-safe rename). Files hardened: `cost-tracker`, `sqlite-provider`, `supabase-base`, `version`, `log-forwarder`, `plugins/registry`.
- **Moved `@rollup/rollup-darwin-arm64` from `dependencies` to `devDependencies`.** The package was incorrectly listed as a runtime dependency even though it is a build-time platform binary used only by Rollup (pulled transitively via Vitest). It is retained in devDependencies as a workaround for npm's known optional-deps installation bug on Apple Silicon.

### Improved

- Empty `catch {}` blocks now emit `logger.debug()` for observability (12 sites across CLI commands, hooks, MCP tools, event bus, dashboard, and memory providers).
- CLI hooks (`session-start`, `session-checkpoint`, `post-write`, `cost-tracker`) migrated away from `console.*`. User-facing hook UI uses `process.stdout.write` directly (Claude Code renders hook stdout); non-UI messages use the structured Logger.
- MCP and dashboard servers now emit structured startup events via Logger instead of `console.error`/`console.log`.
- CI enforces a line-coverage floor of 80% (measured baseline: 85.7%).
- Dashboard banner compressed from 6.7MB to <500KB via lossy resize.
- `benchmarks/ci-latest.json` no longer tracked in git (still uploaded as a CI workflow artifact).
- Stale `.gitignore` reference to the legacy `agentops/` path cleaned up.

### Removed

- `AGENT_SENTRY_REQUIRE_AUTH` environment variable (replaced by secure-by-default behavior).
- `_resetDeprecationWarning` export from `src/mcp/auth.ts` (renamed to `resetAuthWarning` — test-only export).

## [0.5.0-beta.1] - 2026-04-03

### Changed

- **Version reset from 4.1.0-beta.1 to 0.5.0-beta.1.** The v4.x version numbers were inherited from an earlier prototype (AgentOps) and did not represent years of iteration. This project is new and pre-1.0; the version number now honestly reflects that.
- All documentation, plugin metadata, and test fixtures updated to reference v0.5.0
- Removed version strings from documentation headers to reduce maintenance burden

## [4.1.0-beta.1] - 2026-03-29 (Historical)

First beta release. Includes 28 fixes from a comprehensive SDLC analysis covering security, performance, code quality, CI/CD, and documentation.

### Added

- `agent_sentry_generate_handoff` — 10th MCP tool for structured session handoff messages
- `errorMessage()` shared utility used across 25 files for consistent error formatting
- SIGTERM graceful shutdown handler
- npm audit step in CI pipeline
- Vitest coverage configuration
- ESLint `no-floating-promises` and `no-misused-promises` rules enabled
- CI concurrency control (cancels stale runs)
- 4 missing CLI commands documented in README: `prune`, `export`, `import`, `handoff`

### Fixed

- **P1 (Critical):** Startup no longer loads entire events table — uses `getLatestHash()` instead
- **S1:** Auth bypass warning when no access key is configured
- **S2:** PostgREST filter injection in Supabase provider — inputs now sanitized
- **S8:** Removed query parameter authentication; header-only auth enforced
- **S13:** CORS defaults to `localhost` instead of wildcard
- **S14:** UUID validation on all Supabase provider inputs
- **A3:** ONNX model checksum verification on load
- **P2:** `QueryOptimizer` wired into SQLite provider initialization
- **P3:** SQLite `busy_timeout` set to 5000ms to prevent SQLITE_BUSY errors
- **P4:** Smarter cache invalidation with `shortenTtl()` in LRU cache
- **P5:** Embedding LRU cache to avoid redundant computation
- **P7:** Parallel Supabase aggregate queries (was sequential)
- **P8:** Transaction-wrapped batch inserts for atomicity
- **Q8:** ESLint strict promise rules enabled project-wide

### Security

- Patched `path-to-regexp` and `picomatch` high-severity dependency vulnerabilities
- 0 production vulnerabilities (npm audit clean)

### Changed

- Version updated from 4.1.0 to 4.1.0-beta.1 to reflect true project status
- All documentation references updated to v4.1.0-beta

## [4.1.0] - 2026-03-28

### Added

- Comprehensive SDLC analysis with 76 findings across 7 domains
- Full analysis report at `docs/sdlc-analysis-report.md`

## [4.0.0] - 2026-03-25

### Added

- Memory-aware agent management framework
- Hash-chained event storage with SQLite and Supabase providers
- 10 MCP tools for Claude Code integration
- 7 composable primitives (risk scoring, rules validation, secret scanning, context health, git checks, task sizing, event capture)
- 5-level progressive enablement system
- Auto-classification and event enrichment
- Cross-session intelligence (summaries, pattern detection, context recall)
- Plugin system with 4 categories and 11 validation checks
- Single-file HTML monitoring dashboard
- SSE/WebSocket event streaming
- CLI with 13 commands
- ONNX embedding support with noop fallback
