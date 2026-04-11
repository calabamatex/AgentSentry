# AgentSentry — Remaining Follow-ups

Tracking document for items deferred from the 0.6.0-beta.1 hardening pass
(external grade 82 → 88). Everything below is *known and accepted debt*, not a
regression. Grouped by severity and effort.

Last updated: 2026-04-11 (post 0.6.0-beta.1).

---

## P1 — Pre-1.0 Blockers

### 1. Flaky tests under full-suite load
Two test files are timing-sensitive and flake under concurrent suite execution,
even though they pass in isolation:

- `tests/security/enforcement-evasion.test.ts` — ReDoS regex detection asserts
  against wall-clock timing. CPU contention during full-suite runs can push
  "fast" paths past the threshold.
- `tests/performance/benchmark-regression.test.ts` — regression thresholds
  compare against a historical baseline; under load they intermittently
  over-shoot.

Impact: both tests exist specifically to catch regressions, so skipping them
defeats the purpose. They are currently *run* in CI but have known flake risk.

Fix options:
- Gate both files behind a dedicated `vitest run --pool=forks --poolOptions.forks.singleFork`
  invocation in CI (isolated from the main suite).
- Replace wall-clock assertions in `enforcement-evasion.test.ts` with operation
  counts (e.g. regex steps) via a test-only hook.
- Use relative regression baselines (delta vs. the previous run in the same job)
  for `benchmark-regression.test.ts`.

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
