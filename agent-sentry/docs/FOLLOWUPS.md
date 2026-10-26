# AgentSentry — Remaining Follow-ups

Tracking document for items deferred from the 0.6.0-beta.1 hardening pass
(external grade 82 → 88). Everything below is *known and accepted debt*, not a
regression. Grouped by severity and effort.

Last updated: 2026-04-11 (post 0.6.0-beta.1).

---

## P1 — Pre-1.0 Blockers

### 1. Flaky tests under full-suite load — RESOLVED (0.6.0-beta.1 follow-up)
The flake had two distinct causes; both are now addressed.

**(a) Assertion-level timing sensitivity.**
- `tests/security/enforcement-evasion.test.ts` — *already* wall-clock-free. The
  ReDoS test asserts *completion with the correct verdict* under a 30s hard
  ceiling (a true catastrophic backtrack never finishes that fast), so CPU
  contention can't trip it. No change needed.
- `tests/performance/benchmark-regression.test.ts` — the `minOpsPerSecond`
  throughput floors were already loose (~5–10% of baseline), but the absolute
  wall-clock ceilings were still too tight: the concurrent `maxP95Ms: 5000`
  ceiling was *reproduced flaking* at ~5.8s on a loaded box (44× baseline) while
  throughput stayed fine. This pass raises all absolute ms/P95 ceilings to
  catastrophe-only levels (insert/search avg < 3s, batch < 2s, concurrent P95
  < 30s). Throughput floors unchanged — they remain the real regression guard;
  the ms ceilings now only catch an unambiguous seconds-per-op blowup, not a
  slow host.

**(b) Worker-pool OOM — the actual root cause, now fixed.**
The real instability was not the assertions but unbounded worker concurrency.
Vitest defaulted to one fork per CPU core, and every fork loaded the heavy e2e
suite (real `npm install`/`npm pack`) plus benchmarks. On many-core machines
peak memory hit 20GB+, and OOM-killed workers surfaced as intermittent
"Worker exited unexpectedly" / SIGTERM failures. `vitest.config.ts` now pins
`pool: 'forks'` with `maxForks: 4`, bounding peak memory while still
parallelizing. CI runners (~4 vCPU) are essentially unaffected; the cap only
bites on large dev boxes, which is where the OOM occurred.

Remaining (optional): if CI ever shows residual perf-test flake on shared
runners, isolate `tests/performance` into a dedicated `singleFork` job. Not
needed today given the headroom above.

### 2. MCP auth breaking-change rollout
`0.6.0-beta.1` flips the default-deny behavior. Existing installations that
relied on the implicit allow-all path will break on upgrade.

Remaining work:
- Add a migration note to the top of `README.md` (currently only in CHANGELOG
  and SECURITY.md).
- Wire a first-run detection in `init` so the CLI prompts for an access key or
  `AGENT_SENTRY_NO_AUTH=true` explicitly.
- Consider a one-release deprecation window: emit the stderr ERROR but still
  allow the request in `0.6.x`, then actually reject in `0.7.0`.

---

## P2 — Quality & Coverage

### 3. ESLint warnings (16 remaining)
`npm run lint` passes with 0 errors but 16 pre-existing warnings. These are
all shallow fixes:

| File | Warnings |
|------|----------|
| `src/cli/commands/config.ts` | 2× unused imports (`fs`, `ensureDirectorySafe`) |
| `src/cli/commands/enable.ts` | unused `fs`; 1× `any` |
| `src/cli/commands/handoff-templates.ts` | unused `TodoItem` |
| `src/cli/commands/handoff.ts` | unused `readMemoryFiles` |
| `src/cli/commands/init.ts` | 1× `any`; 1× `require()` import |
| `src/enforcement/engine.ts` | unused `EnforcementAction` |
| `src/mcp/server.ts` | 2× `no-misused-promises` in SIGINT/SIGTERM handlers |
| `src/mcp/tools/health.ts` | 2× `require()` imports; 2× `any` |
| `src/mcp/transport.ts` | unused `actualPort` |

Fix: one pass to delete dead imports, type the `any`s, convert dynamic
`require()` to `await import()`, and wrap signal handlers in a `void` IIFE.

### 4. Coverage floor ratchet
Current line coverage: **85.7%**. CI floor: 80%. The floor was deliberately set
5 points below baseline to avoid false-positive failures, but the goal is to
tighten it over time.

Plan:
- After 2–3 stable beta releases, raise floor to 85%.
- Branch + function coverage are *not* currently gated — add them at the same
  ratchet step.

### 5. Supabase integration tests
`tests/memory/providers/supabase-integration.test.ts` uses `describe.skipIf(!HAS_SUPABASE)`
and is skipped in CI (no test project provisioned). The Supabase provider is
marked experimental but is still shipped in `src/`. Options:
- Provision a disposable Supabase project for CI and wire its URL/key into
  GitHub secrets.
- Or explicitly gate the Supabase provider behind an experimental flag and
  document that the integration tests only run locally.

---

## P3 — Hardening & Polish

### 6. Branch protection
The repo currently has no enforced branch protection on `main`. Required:
- Require PR review before merge.
- Require status checks: `build-and-test`, `lint`, `security`, `smoke-test-install`,
  `doc-validation`, `benchmark`.
- Require linear history (no merge commits from feature branches).
- Block force-pushes on `main`.

This is a GitHub settings change, not a code change — tracked here so it
doesn't drift.

### 7. Dashboard auth warning parity
`src/dashboard/server.ts` generates a random token if none provided and logs
it via `logger.info('Dashboard started', { token })`. Unlike the MCP server,
it has no default-deny / opt-out ENV semantics. For consistency with the MCP
auth rework, consider:
- Mirror `AGENT_SENTRY_NO_AUTH` → `AGENT_SENTRY_DASHBOARD_NO_AUTH`.
- Default-deny when no token is configured (error on start instead of auto-
  generating).

### 8. `src/version.ts` empty catch
The candidate-path lookup loop still uses `} catch { continue; }` intentionally
(expected-failure probing). It is annotated with `// try next candidate path`
but not enforced by a lint suppression. Low risk, but a
`// eslint-disable-next-line` would make the intent explicit.

### 9. Tarball smoke-test coverage
`smoke-test-install` in CI verifies import, MCP server, CLI, and config
resolution. It does **not** currently:
- Run a real MCP tool call against a stdio transport.
- Verify the CLI `doctor` / `init` / `status` commands work end-to-end.

A 30-second end-to-end test would catch the majority of packaging regressions
the current smoke test can miss.

### 10. Banner compression is lossy & one-way
`dashboard/assets/agent-sentry-banner.png` was compressed from 6.7MB → 480KB
in-place via sharp. The original high-resolution source is **not** stored in
git. If design work requires a re-edit, the source needs to be re-exported.

Fix: commit the source PSD / high-res PNG to a separate `dashboard/assets/src/`
directory and gitignore it by default (or use Git LFS if retention matters).

### 14. vitest 4.x migration (deferred — PR #38 closed)
`vitest`/`@vitest/coverage-v8` are on 2.x. Bumping to 4.x clears the remaining
**dev-only** `esbuild`/`vitest` critical advisories (full `npm audit` 7 → 1
moderate). It was attempted in PR #38 and **deferred** because the cost is
disproportionate to dev-only cleanup that never ships and doesn't affect the
prod-security gate (already clean at `--omit=dev --audit-level=high`):

- Vitest 4 / rolldown require **Node ≥ 20.12** → drops EOL Node 18 (a breaking
  `engines` change; `>=18` → `>=20`, CI matrix `[18,20,22]` → `[20,22,24]`).
- Vitest 4 rejects mocked constructors defined with arrows
  (`X: vi.fn().mockImplementation(() => ({...}))`) — ~9 test files
  (`Logger`/`MemoryStore`/`Server`/`Transport` mocks) must convert to
  `vi.fn(function () { ... })`, plus likely further incompatibilities across the
  ~1,450 untested tests (several CI rounds).

Do this as a **deliberate** combined "vitest 4 + drop Node 18" migration when
there is a real driver, not as collateral. A worked example of the mock fix is
in the closed PR #38 (`tests/mcp/transport.test.ts`).

---

## P4 — Docs

### 11. Migration guide
No dedicated `docs/migration/0.5-to-0.6.md`. The changelog entry is terse and
assumes the reader already knows how auth used to work. A short guide would
help.

### 12. Updated architecture docs
`docs/architecture/mcp-integration.md` still describes the pre-0.6 auth model.
Section on "Authentication" needs a rewrite to match the new default-deny
semantics.

### 13. Observability guide
The new Logger-based workflow (structured JSON, module + traceId fields)
has no user-facing doc. A short `docs/observability.md` explaining:
- Where logs go (`stderr`, JSON-lines format)
- How to enable `LOG_LEVEL=debug`
- How to filter by module
- How to ship logs to an external collector

…would close the loop on the Phase 5 migration.

---

## Out of scope (intentionally not tracked)

- `onnxruntime-node` optional dependency tree — already documented in
  `docs/troubleshooting.md`.
- Apple Silicon `@rollup/rollup-darwin-arm64` workaround — documented in
  `CHANGELOG.md` 0.6.0-beta.1 entry.
- `agentops/` → `agent-sentry/` rename artifacts — cleaned up in 0.6.0-beta.1.
