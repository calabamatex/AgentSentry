# AgentSentry — Enhancement & Remediation Workplan (Agent-Executable) — v1.2

**Target repo:** https://github.com/calabamatex/AgentSentry
**Baseline commit:** `1f3e0b9` (origin/main, verified 2026-07-02)
**Audience:** AI coding agent (Claude Code or equivalent). Every work item is self-contained: rationale, exact file/line anchors, required change, acceptance criteria, and verification commands. Line numbers are anchors at the baseline commit — re-locate by the quoted code if the file has drifted.

> **This document supersedes the previous remediation plan at this path** (Phases 1–5 of that plan are complete — see this file's git history for the implementation record). Its open items were ported here: Task 6.1 → WI-103, Task 6.2 → WI-025, Task 6.3/6.4 → WI-026, history-shrink note → WI-015 item 8. Nothing was dropped.

---

## Revision History

**v1.2 (2026-07-02) — capture + decisions.** This plan replaced the prior in-tree remediation plan (executing WI-024). Ported from the old plan: WI-025 (coordination CAS honesty), WI-026 (over-mocked boundary tests + flaky-timing verification), WI-015 item 8 (optional history shrink). Owner decisions recorded: WI-004 → never auto-suggest L6 (decided); WI-006 → skip required-review until a second maintainer (decided); WI-015 item 5 → purge + gitignore recommended, **pending owner confirmation**.

**v1.1 (2026-07-02) — review amendments.** All plan claims were spot-checked against source at `1f3e0b9`; the factual anchors verified. Changes from v1.0:

1. **WI-003 corrected** — the v1.0 instruction misdescribed `src/mcp/auth.ts` (it does NOT SHA-256-hash before comparing; it length-checks with a dummy `timingSafeEqual` — verified at `auth.ts:56–63`). Rewritten to extract the *actual* existing comparator into a shared util instead of reimplementing.
2. **New WI-024** — reconcile/retire the pre-existing `agent-sentry/docs/remediation-plan.md` (verified in-tree at baseline). Executed in v1.2 by this document.
3. **New Ground Rule 0** — execution must start from a fresh branch off `origin/main`. The local `fix/beta-hardening` checkout is stale: its content is already on main (content-identical `transport.ts`/`embeddings.ts` at baseline; commits re-landed via squash), and its working tree is dirty.
4. **WI-015 item 5 amended** — the `.claude/` purge requires an owner decision first: the owner's working tree contains AQE v3 agent definitions under `.claude/agents/v3/` and a locally modified `CLAUDE.md` that references them.
5. **WI-004 demoted P1→P2** (one-line product decision on an experimental opt-in level is not release-blocking; stays in Wave 1 because it is XS and pins behavior before tagging).
6. **WI-005 moved to Wave 1** — the `v0.6.0-beta.2` publish that follows Wave 1 should already carry provenance.
7. **WI-013 promoted to Wave 2** — it guards every release artifact.
8. **WI-001 step 4 softened** — no `git tag -f` on public tags (fetched clones keep the old object); delete + CHANGELOG note instead.
9. **WI-009 acceptance scoped** — justification comments limited to the named fan-out modules, not repo-wide.
10. **WI-006 amended** — solo-maintainer friction acknowledged; allow admin-merge bypass or aggressive bundling.
11. **WI-016 amended** — add the stale `fix/beta-hardening` branch (local + remote if pushed) to the prune list.
12. **WI-023 amended** — baseline recapture must be platform-labeled; darwin fsync semantics are a real platform difference, not only load noise.

---

## 0. Ground Rules (read before any work item)

0. **Starting state:** create every work branch fresh from `origin/main` (`git fetch origin && git switch -c <branch> origin/main`). Do **not** work from the local `fix/beta-hardening` checkout — its security/hardening content already landed on main via squash-merge (verified: `git diff 1f3e0b9 fix/beta-hardening -- agent-sentry/src/mcp/transport.ts` is empty), local `main` is behind `origin/main`, and the working tree carries uncommitted local tooling (`.claude/agents/v3/`, modified `CLAUDE.md`, `.mcp.json`). Stash or set aside local-only changes before starting; the stale branch itself is pruned in WI-016.
1. **Working directory:** all build/test commands run from `agent-sentry/` unless stated otherwise.
2. **Verification loop per item:** `npm run build && npm run lint && npm run test:unit`. Before any PR: `npm test` (full suite incl. contracts) — the contract tests in `tests/contracts/` intentionally fail on doc/version drift; if they fail, fix the drift, do not weaken the test.
3. **Conventions:** conventional commits (`feat(scope):`, `fix(scope):`, `docs:`, `chore:`); strict TypeScript — **zero `: any`** (currently zero in `src/`; keep it that way); no TODO/FIXME in source — track deferred work in `docs/FOLLOWUPS.md`.
4. **One work item per PR** unless items are explicitly marked as bundleable. *(Note: with a single maintainer, prefer the bundleable pairings in the wave plan to avoid self-imposed review gridlock — see WI-006.)*
5. **Do not** ship probabilistic outputs without confidence labeling — the `Confidence` type (`src/risk-scoring/types.ts`) and calibration gate (`src/risk-scoring/calibration/gate.ts`) are load-bearing project invariants.
6. **Sync obligations:** any change to version, tool count, level count, or skill list must be reflected in `README.md` (root + package), `docs/api-reference.md`, `CHANGELOG.md`, and will be checked by `tests/contracts/doc-contracts.test.ts` and `scripts/sync-release-metadata.ts --check`.
7. Priorities: **P1** = release-blocking correctness/security; **P2** = pre-1.0; **P3** = quality; **E** = enhancement track (new capability).

---

## TRACK A — P1/Wave-1: Release-Blocking Fixes

### WI-001 · Reconcile versioning end-to-end
**Priority:** P1 · **Type:** fix/chore · **Effort:** S

**Problem (verified):** three conflicting version sources.
- `agent-sentry/package.json` → `0.6.0-beta.1` (canonical)
- Git tags → `v4.0.0`, `v4.1.0-beta` (legacy AgentOps-era numbering; CHANGELOG documents the deliberate 4.x→0.x reset)
- `agent-sentry/bin/agent-sentry.sh:27` → hardcoded `VERSION="4.0.0"` — the bash CLI reports v4.0.0 of a 0.6.0-beta package.

**Required changes:**
1. In `bin/agent-sentry.sh`, replace the hardcoded assignment with runtime resolution from `package.json` co-located with the script:
   ```bash
   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   VERSION="$(node -p "require('$SCRIPT_DIR/../package.json').version" 2>/dev/null || echo "unknown")"
   ```
2. Extend `scripts/sync-release-metadata.ts` `--check` mode to grep `bin/agent-sentry.sh` for any literal `VERSION="[0-9]` pattern and fail if found.
3. Add a contract test in `tests/contracts/` asserting the shell script contains no hardcoded semver literal.
4. Tag hygiene (repo-owner action; document in PR description). Do **not** `git tag -f` published tags — anyone who has fetched keeps the old tag object, producing split-brain tags. Instead: **delete** `v4.0.0`/`v4.1.0-beta` from the remote (`git push origin :refs/tags/v4.0.0 :refs/tags/v4.1.0-beta`), create `v0.6.0-beta.1` at the release commit, and add a "Versioning history" section to `CHANGELOG.md` recording the AgentOps-era tags, their commit SHAs (so history stays reconstructable), and the deliberate 4.x→0.x reset.

**Acceptance:** `bash bin/agent-sentry.sh version` prints `0.6.0-beta.1`; `npm run sync-metadata:check` passes and fails when a hardcoded version is reintroduced; contract suite green.

---

### WI-002 · Delete dead duplicate modules compiled into dist
**Priority:** P1 · **Type:** fix/chore · **Effort:** S

**Problem (verified):** `agent-sentry/core/event-bus.ts` (168 LOC, singleton variant, header "AgentSentry Event Bus (§21.3)"), `agent-sentry/audit/audit-logger.ts` (258 LOC), `agent-sentry/tracing/trace-context.ts` (216 LOC) live **outside `src/`**, are imported by **nothing** (all imports of `../core/event-bus` — `src/memory/event-subscriber.ts:6`, `src/streaming/event-stream.ts:13` — resolve to `src/core/event-bus.ts`), yet are compiled into `dist/` via `tsconfig.json`:
```json
"include": ["src/**/*.ts", "core/**/*.ts", "audit/**/*.ts", "tracing/**/*.ts"]
```
`core/event-bus.ts` also **diverges** from `src/core/event-bus.ts` (149 LOC) — a copy-paste/incomplete-refactor hazard.

**Required changes:**
1. Diff each stray file against its `src/` counterpart (only `core/event-bus.ts` has one). If the stray version contains behavior absent from `src/` that tests or docs reference (check `git log --follow` on each), port it deliberately in a separate commit; expected outcome is that nothing is needed.
2. Delete `core/`, `audit/`, `tracing/` directories at `agent-sentry/` root.
3. Set `"include": ["src/**/*.ts"]` in `tsconfig.json`.
4. Remove the corresponding lines from `.npmignore` (they become moot).
5. Verify `dist/` contents shrink accordingly: the package-contents contract test (`tests/contracts/package-contents.test.ts`) should be updated if it enumerates these paths.

**Acceptance:** `npm run build` succeeds; `ls dist/` contains no `core/event-bus.js` outside `dist/src/`; `grep -rn "from '../../core\|from '../../audit\|from '../../tracing'" src tests` returns nothing; full test suite green.

---

### WI-003 · Harden dashboard authentication to MCP parity
**Priority:** P1 · **Type:** security · **Effort:** M

**Problem (verified at `src/dashboard/server.ts`, `authenticateRequest`):**
- Bearer-token check uses non-constant-time `authHeader.slice(7) !== this.token`.
- SSE query-param check `queryToken === this.token` — also non-constant-time, **and** places the credential in a URL (leaks to logs, browser history, referrer headers).
- Constructor: if no token is provided, one is **auto-generated** (`crypto.randomBytes(24)`) rather than failing closed — inconsistent with the MCP layer's require-auth-by-default posture (0.6.0 breaking change). Tracked as open in `docs/FOLLOWUPS.md` ("Dashboard auth parity").

**Required changes:**
1. *(Corrected in v1.1 — the v1.0 text claimed `src/mcp/auth.ts` "hashes both sides with SHA-256 to normalize length"; that is **false**. Verified: `auth.ts:56–63` builds raw buffers, and on length mismatch performs a dummy `timingSafeEqual(expectedBuf, expectedBuf)` before returning false; on equal length it compares directly.)* **Extract that existing comparator** from `src/mcp/auth.ts` into a shared util (e.g., `src/utils/timing-safe.ts`, exported as `timingSafeStringEqual(a, b)`), re-import it in `auth.ts` (behavior-preserving refactor; existing MCP auth tests must stay green untouched), and use it in `server.ts` for both the bearer and query-param comparisons. Do not write a second comparator implementation — one shared, tested primitive.
2. Mitigate query-param exposure: keep it (EventSource cannot set headers) but (a) accept a short-lived derived token instead of the primary token — add `GET /api/session-token` (bearer-authenticated) returning an HMAC-derived token valid ~60s, verified for SSE connects; or, minimally, (b) document the exposure in `docs/dashboard-guide.md` and ensure the token never appears in server logs (audit `logger.*` calls in `server.ts`). *(Guidance: option (b) is proportionate for a beta dashboard that binds `127.0.0.1` by default; do (a) as part of WI-105 where token infrastructure is being built anyway. Either satisfies acceptance.)*
3. Fail-closed parity: refuse to start without a token unless `AGENT_SENTRY_NO_AUTH=1` is set (same env-var semantics as MCP transport — note `src/mcp/server.ts:142` accepts both `'true'` and `'1'`; match that). Auto-generation may remain only under an explicit `--dev` flag or the no-auth env var. Log the effective auth mode at startup at `warn` level when auth is disabled.
4. Update `tests/dashboard/auth.test.ts`: timing-safe path (equal/unequal lengths), fail-closed default, `AGENT_SENTRY_NO_AUTH=1` bypass, SSE token flow.
5. Document the breaking change in `CHANGELOG.md` [Unreleased] and the migration note (see WI-019).

**Acceptance:** no `!==`/`===` comparisons against `this.token` anywhere in `src/dashboard/`; `src/mcp/auth.ts` and `src/dashboard/server.ts` both call the single shared comparator; server exits non-zero with a clear message when started tokenless without the env override; all dashboard + MCP auth tests green.

---

### WI-004 · Resolve the Level-6 ceiling in enablement queries — **DECIDED**
**Priority:** P2 *(demoted from P1 in v1.1; kept in Wave 1 because it is XS and pins behavior before tagging)* · **Type:** fix · **Effort:** XS

**Problem (verified at `src/enablement/engine.ts`):** the system defines 6 levels (`generateConfigForLevel` handles `level >= 6`: `config.skills.risk_scoring = full()`), but `getNextLevel()` returns `null` at `config.level >= 5`, so Level 6 is never surfaced as a next step. The docstring says "or null if already at max" — max is 6.

**Owner decision (2026-07-02): L6 is never auto-suggested — strictly opt-in.** Implement:
```ts
const MAX_AUTO_SUGGEST_LEVEL = 5; // L6 (Risk Watch) is [experimental] and opt-in only;
                                  // never auto-suggested. See docs/architecture/risk-scoring.md.
if (config.level >= MAX_AUTO_SUGGEST_LEVEL) return null;
```
Add a test pinning the behavior (`tests/enablement/engine.test.ts`: `getNextLevel` at level 5 → `null`; at level 4 → level 5). Fix the `getNextLevel` docstring ("max auto-suggested level", not "max"). Update `docs/architecture/enablement-model.md` to state the intent.

**Acceptance:** behavior is test-pinned and documented; no bare `5`/`6` literals in the query helpers.

---

### WI-005 · npm provenance / trusted publishing
**Priority:** P2 · **Type:** security/CI · **Effort:** S · *(Wave 1: the `v0.6.0-beta.2` publish that concludes Wave 1 should already carry provenance — sequencing this later means one more unattested release.)*

`.github/workflows/publish.yml` publishes on GitHub release with a long-lived `NODE_AUTH_TOKEN` and no provenance. Changes: (1) add `id-token: write` permission to the publish job and `npm publish --provenance`; (2) migrate to npm Trusted Publishing (OIDC) if the org account supports it, eliminating the stored token; (3) add an `environment:` with required reviewers to gate publishes behind manual approval. **Acceptance:** published package shows provenance attestation on npmjs.com; no `NODE_AUTH_TOKEN` secret required (or documented fallback if OIDC unavailable).

---

## TRACK B — P2: Security & Robustness

### WI-006 · Branch protection + repo settings — **DECIDED**
**Priority:** P2 · **Type:** chore (owner/API action) · **Effort:** XS

Self-identified open item (FOLLOWUPS P3). Enable on `main`: require status checks (`build-and-test`, `lint`, `security`), require linear history, forbid force-push. **Owner decision (2026-07-02): skip the "require PR review ≥1" rule for now** — CI checks still gate every merge; add the review rule when a second maintainer exists. Document the settings and the deferred review rule in `CONTRIBUTING.md` so they are auditable in-tree. If the agent has `gh` access: `gh api repos/calabamatex/AgentSentry/branches/main/protection -X PUT --input protection.json`.

### WI-007 · ReDoS audit of secret/PII regexes
**Priority:** P2 · **Type:** security · **Effort:** M

**Scope:** `src/primitives/secret-detection.ts` (11 hardcoded patterns), `src/mcp/tools/scan-security.ts` (15 secret + 15 PII patterns), `scripts/secret-scanner.sh`. **Changes:** (1) run each pattern through a ReDoS analyzer (`recheck` npm package, dev-dependency) in a new test `tests/security/redos.test.ts` that asserts every pattern is safe or linear-time; (2) rewrite any flagged pattern (typical fixes: replace nested quantifiers, bound repetitions like `{1,512}`); (3) as defense-in-depth, cap scanned input length per call (e.g., 1 MB) with an explicit truncation note in the tool result. **Acceptance:** `recheck`-based test green in CI; adversarial input (e.g., 100 KB of `"a"` against each pattern) completes < 100 ms in the resource-exhaustion test suite.

### WI-008 · Fix downloader stream teardown race
**Priority:** P2 · **Type:** fix · **Effort:** S

`src/memory/embeddings.ts` (~lines 248–255, ONNX `downloadFile`): the HTTP response stream can be destroyed while the write stream settles, risking a partially-written file or unhandled error on abort/size-cap paths. **Changes:** use `stream.pipeline` (promisified) instead of manual piping; ensure the size-cap abort path destroys both streams and unlinks the temp file; download to a random temp name and rename only after the SHA-256 check passes (verify this ordering already holds — checksum verify is at line ~201). Add tests: simulated mid-stream abort, over-cap response, checksum mismatch — each must leave no partial file at `destPath`. **Acceptance:** new tests green; `pipeline` used; no `.on('error')`-less streams in the download path.

### WI-009 · `Promise.all` → `allSettled` in fan-out paths
**Priority:** P2 · **Type:** fix · **Effort:** S

Audit: `grep -rn "Promise.all(" src/`. For each site, classify: (a) all-or-nothing semantics required → keep `Promise.all`; (b) independent fan-out (multi-provider health checks, batch event capture, plugin notifications, log-forwarder flush) → switch to `allSettled`, aggregate failures into a structured result, and log rejected reasons. Do not blanket-replace — transactional paths must still fail fast. The justification-comment requirement applies only to `Promise.all` sites **in the fan-out modules named above** where the audit decided to keep fail-fast semantics — not to every `Promise.all` in the codebase. **Acceptance:** each converted site has partial-failure test coverage; each *retained* `Promise.all` in the audited fan-out modules carries a one-line justification comment.

### WI-010 · Rate limiting behind proxies
**Priority:** P2 · **Type:** fix · **Effort:** S

`src/mcp/transport.ts`: per-IP limiter (100 req/60 s, 10 K store cap) keys on socket address — collapses all clients behind a NAT/reverse proxy into one bucket and is trivially reset by IP rotation. **Changes:** (1) add opt-in `AGENT_SENTRY_TRUST_PROXY=1` to key on the first `X-Forwarded-For` hop (only when set — never trust the header by default); (2) secondary key on access-key hash where present (authenticated callers get per-key buckets); (3) document both in `docs/configuration.md`. **Acceptance:** tests cover: default ignores XFF; trust-proxy honors XFF; per-key bucketing isolates two keys from one IP.

### WI-011 · Make SQLite durability trade-off explicit and configurable
**Priority:** P2 · **Type:** fix/docs · **Effort:** XS

`src/memory/providers/sqlite-provider.ts` sets `synchronous=NORMAL` (small power-loss window, acceptable with WAL, currently undocumented). **Changes:** expose `AGENT_SENTRY_SQLITE_SYNCHRONOUS` (`NORMAL` default | `FULL`), validate the value, document the trade-off in `docs/architecture/memory-model.md` (note: hash-chain verification will *detect* a torn tail; FULL prevents it). **Acceptance:** config test for both values; docs updated.

### WI-012 · Un-skip Supabase integration tests in CI
**Priority:** P2 · **Type:** CI/test · **Effort:** M

Currently skipped (FOLLOWUPS P2). **Changes:** add an optional CI job gated on `secrets.SUPABASE_TEST_URL`/`SUPABASE_TEST_KEY` presence (skip cleanly when absent, so forks stay green); run `tests/memory/providers/supabase-integration.test.ts` + `tests/e2e/supabase-smoke.test.ts` against a disposable schema (create/drop per run, UUID-suffixed); document setup in `docs/supabase-setup.md`. **Acceptance:** job green on repo with secrets; skipped-not-failed without them.

### WI-013 · Real end-to-end call in the tarball smoke test
**Priority:** P2 · **Type:** CI/test · **Effort:** S · *(Wave 2: guards every release artifact; should be in place before the hardening waves start shipping.)*

`ci.yml` `smoke-test-install` verifies `require()` and entry-point existence only (FOLLOWUPS P3). **Changes:** after install, (1) run `npx agentsentry init && npx agentsentry health` in the temp project and assert exit 0 + expected JSON keys; (2) start the MCP server over stdio and drive one `tools/list` + one `agent_sentry_check_context` call via a minimal JSON-RPC script; assert a valid result. **Acceptance:** smoke job fails if any CLI command or MCP round-trip breaks in the packed artifact.

### WI-014 · Unicode/homoglyph evasion coverage in enforcement + secret detection
**Priority:** P2 · **Type:** test/security · **Effort:** S

`tests/security/enforcement-evasion.test.ts` lacks normalization attacks. **Changes:** add cases — NFC/NFD variants, zero-width joiners/spaces inside keywords (`rm -rf`, key prefixes like `AKIA`), fullwidth Latin, RTL-override; where detection fails, add NFKC normalization + zero-width stripping as a pre-processing step in `secret-detection.ts` and the enforcement matcher (behind a small shared util in `src/utils/`). **Acceptance:** all new evasion cases detected; no regression in existing golden-file evals (`evals/secret-scanner/cases.yaml`).

### WI-025 · Make coordination concurrency honest (ported from prior plan Task 6.2)
**Priority:** P2 · **Type:** fix · **Effort:** M

`src/coordination/coordinator.ts:7` header admits "No CAS — race conditions possible." Either (a) add an atomic guard — SQLite transaction / `INSERT … ON CONFLICT` compare-and-set — with a contended-lock test, or (b) mark the module `@experimental` in its public exports and the README capability table so the limitation is user-visible. Path (a) preferred pre-1.0; path (b) is acceptable if (a) proves invasive, but must then be documented in Known Limitations. **Acceptance:** either a passing contended-write test proving atomicity, or `@experimental` markers + doc entry; no silent third state.

### WI-026 · Strengthen over-mocked boundary tests + verify flaky-timing residue (ported from prior plan Tasks 6.3/6.4)
**Priority:** P3 · **Type:** test · **Effort:** M

(a) `tests/mcp/tools/*` and `tests/primitives/*` mock `MemoryStore`/`ContextRecaller` and assert on stubs. Convert high-value ones (`recall-context`, `capture-event`) to drive a real in-memory SQLite store, matching the pattern in `tests/memory/providers/sqlite-provider.test.ts`. (b) The prior plan's Task 6.4 (timing-based flakiness: `tests/coordination/coordinator.test.ts:187,208,301,441`, `tests/memory/*` date math) is believed resolved by PR #41 ("stabilize flaky perf/suite tests", merged to main) — **verify** those specific sites no longer use raw `setTimeout`/`Date.now()` sequencing; convert any stragglers to `vi.useFakeTimers()` or an injectable clock. **Acceptance:** converted boundary tests hit a real store; zero raw-timer sequencing in the cited files; full suite green 3× consecutively.

---

## TRACK C — P2: Repository Hygiene

### WI-015 · Purge non-project artifacts (bundleable single PR)
**Priority:** P2 · **Type:** chore · **Effort:** S

All verified at baseline:
1. **Delete** `website/` (contains only `.claude-flow/` daemon logs).
2. **Delete** root `package-lock.json` (stub: empty `packages` object, no root `package.json`).
3. **Delete** `.claude/skills/skill-builder/.claude-flow/metrics/*.json` (runtime metrics).
4. **Delete** `agent-sentry/dashboard/agent-sentry-dashboard.html` (unreferenced static snapshot; `src/dashboard/html.ts` is authoritative) — first `grep -rn "agent-sentry-dashboard.html"` across repo/docs and fix any references.
5. **`.claude/` policy — RECOMMENDED: purge + gitignore (pending owner confirmation).** Rationale: the AQE v3 agents in the owner's working tree are machine-generated scaffolding (regenerable via `aqe init` / `claude-flow init`), and the `CLAUDE.md` AQE section referencing them is a *local uncommitted* modification — the committed `CLAUDE.md` on main does not reference `.claude/agents/v3/`, so nothing tracked breaks. Execute as: remove `.claude/` from the repo, add `.claude/` + `.mcp.json` to `.gitignore`, note in `CONTRIBUTING.md` ("regenerate locally via claude-flow / AQE init"). The owner keeps AQE tooling locally, untracked. **Do not commit the local `CLAUDE.md` AQE additions to main** unless the owner instead opts to version the curated `.claude/agents/v3/` subset — in that case purge only generic scaffolding and runtime artifacts. Record the confirmed decision in the PR description.
6. **`.gitignore` additions:** `website/`, `**/.claude-flow/`, plus `.claude/` or its runtime subpaths per the item-5 decision.
7. **Delete** the 133-byte git-LFS pointer `agent-sentry/models/all-MiniLM-L6-v2.onnx` — the code downloads the real model on first use with checksum verification (`embeddings.ts:103,201`); the in-tree pointer is dead weight and confuses non-LFS clones. Keep `tokenizer.json` (shipped intentionally). Update any doc referencing the in-repo model path.
8. **Optional (owner sign-off required; ported from prior plan):** git history still contains the ~263 MB of previously-tracked `coverage/` artifacts. A `git filter-repo` shrink would reduce clone size dramatically but **rewrites history** — destructive, invalidates existing clones/forks, must be coordinated deliberately. Not part of this item's default execution; track as a standing FOLLOWUPS entry until decided.

**Acceptance:** `git ls-files | grep -E "daemon.log|\.claude-flow/metrics"` empty; clone size measurably reduced; build/tests unaffected; package-contents contract test updated if it enumerates `models/`; item-5 decision recorded.

### WI-016 · Prune stale remote branches
**Priority:** P3 · **Type:** chore · **Effort:** XS

~15 merged `origin/claude/*` branches plus `calabamatex-patch-1`. Delete all fully-merged branches (`git branch -r --merged main`); enable GitHub's "Automatically delete head branches" setting. Also delete the local `fix/beta-hardening` branch — and its remote if pushed. Its content already landed on main via squash-merge (verified: content-identical `src/mcp/transport.ts`, `src/memory/embeddings.ts` at `1f3e0b9`), so `--merged` will NOT list it; verify equivalence with `git diff origin/main fix/beta-hardening -- agent-sentry/src` before deleting, and rescue any local-only working-tree files first per Ground Rule 0.

---

## TRACK D — P2/P3: Documentation Corrections

### WI-017 · Correct the EU AI Act claim
**Priority:** P2 · **Type:** docs · **Effort:** XS

Root `README.md:71` claims the audit trail is "EU AI Act Article 12 compliant." A hash-chained log *supports* Article 12 record-keeping; it does not confer compliance, and no assessment backs the phrase. Replace with: "Append-only, hash-chained event log with semantic search — designed to support EU AI Act Article 12 record-keeping/audit-trail requirements." Sweep for the same phrase: `grep -rn "EU AI Act" --include='*.md' .` and fix every instance (also present in `agent-sentry/README.md:41`).

### WI-018 · Fix stale default-level statement
**Priority:** P2 · **Type:** docs · **Effort:** XS

`agent-sentry/docs/architecture/enablement-model.md` (§Default Level Rationale) says default is Level 3; code, root README, `CLAUDE.md`, and package README all say Level 2. Fix the doc to Level 2 and rewrite the rationale paragraph accordingly. Add an assertion to `tests/contracts/doc-contracts.test.ts` that the documented default level matches `DEFAULT_LEVEL` (or equivalent constant) in `src/enablement/engine.ts` so this class of drift is mechanically caught.

### WI-019 · Write the 0.5→0.6 migration guide
**Priority:** P2 · **Type:** docs · **Effort:** S

Open FOLLOWUPS item. Create `agent-sentry/docs/migration-0.5-to-0.6.md`: MCP HTTP auth now required by default (`AGENT_SENTRY_ACCESS_KEY`), `AGENT_SENTRY_NO_AUTH=1` escape hatch, dashboard auth changes from WI-003, config schema deltas, step-by-step upgrade checklist. Link from both READMEs and `CHANGELOG.md`. Also refresh `docs/architecture/mcp-integration.md`, which is stale on the auth model (self-identified, FOLLOWUPS P4).

### WI-020 · Fill remaining doc gaps (bundleable)
**Priority:** P3 · **Type:** docs · **Effort:** M

(a) Observability user guide (Logger JSON-lines format, `LOG_LEVEL`, module filtering, metrics endpoints, circuit-breaker tuning) — FOLLOWUPS P4. (b) Expand `docs/supabase-setup.md` (currently sparse): schema migration (`supabase-migration.sql`), RLS guidance, connection pooling config. (c) Link `docs/planning/` (product spec, OB1 analysis, architecture evolution) from the root README under "Design history" — currently invisible to npm consumers. (d) Document what `intelligence.ts` pattern detection actually returns (worked example in `docs/examples/`). (e) Re-label the ROADMAP "Evals" line from implying attack-pattern coverage to describing the current golden-file harness (currently overstates).

### WI-021 · Clear the remaining ESLint warnings (18 at baseline, not 16)
**Priority:** P3 · **Type:** chore · **Effort:** S

FOLLOWUPS P2 says 16; dynamic run measured **18** — fix the FOLLOWUPS count too. Unused imports, loose types, `require()` imports in `src/cli/commands/config.ts`, `enable.ts`, `init.ts`; intentional empty catch in `src/version.ts` needs a scoped `// eslint-disable-next-line no-empty` with justification comment rather than a global rule change. Then set `lint` to `--max-warnings 0` in `package.json` so warnings become CI-blocking.

### WI-022 · Ratchet the coverage floor
**Priority:** P3 · **Type:** CI · **Effort:** XS

Baseline ~85.7% lines vs. CI gate 80% (`ci.yml`: `--coverage.thresholds.lines=80`). Raise to 84 now (headroom below baseline), and add a FOLLOWUPS note to move to 85 after two stable releases per the existing plan. Never lower without a CHANGELOG entry. Keep `vitest.config.ts` thresholds and the CI flag in sync — both exist.

### WI-024 · Reconcile the pre-existing in-tree remediation plan — **EXECUTED by this document (v1.2)**
**Priority:** P2 · **Type:** docs · **Effort:** XS

The previous `docs/remediation-plan.md` (Phases 1–5 complete, Phase 6 open) was replaced by this workplan at the same path. Port record: Task 6.1 → WI-103, Task 6.2 → WI-025, Tasks 6.3/6.4 → WI-026, Phase-5 history-shrink note → WI-015 item 8. The prior plan's implementation notes survive in this file's git history. Remaining step at commit time: CHANGELOG note recording the replacement. **Acceptance:** exactly one remediation-plan document tracked in the repo; no open item from the old plan silently dropped (verified — port record above).

---

## TRACK E — Enhancements (new capability; each gated behind config/flags)

### WI-100 · Beta-Binomial conjugate updating for pattern base rates
**Priority:** E1 (highest-value enhancement) · **Type:** feat(risk-scoring) · **Effort:** L

**Context:** the current "Bayesian layer" is a bounded heuristic interpolation (`misbehavior-profiles.ts:57`), honestly labeled `default_priors`. The infrastructure for real inference already exists: `sample_size` tracking, `pattern_statistics` table (migration v5), the `Confidence` type, and the calibration gate. This item makes the Bayesian labeling true.

**Design:**
1. New module `src/risk-scoring/scoring/bayesian.ts` (the path the plan reserved at `docs/risk-scoring-plan.md` D1).
2. Per pattern/profile, maintain Beta(α, β): α₀,β₀ derived from the hand-authored `base_likelihood` with an explicit equivalent-sample-size prior weight (e.g., ESS = 10 → α₀ = base·10, β₀ = (1−base)·10; make ESS a constant in `constants.ts`).
3. On each labeled outcome (from the calibration harness's `Prediction` records), update α+=hit, β+=miss; persist in `pattern_statistics` (add columns via `migration-v6.ts` following the existing migration pattern in `src/memory/migrations/`).
4. Score = posterior mean α/(α+β); report posterior variance. **Confidence basis rules (non-negotiable):** output remains `default_priors` (value ≤ 0.5) until (a) `sample_size ≥ minimum_samples_for_calibration` AND (b) the calibration gate (`gate.ts`) passes on the posterior-mean forecasts — only then flips to `calibrated`, with `sample_size` = α+β−ESS.
5. Engine integration: `engine.ts` consults `bayesian.ts` when statistics exist, else falls through to the current deterministic path (backward-compatible; `tests/risk-scoring/backward-compat.test.ts` must stay green untouched).

**Tests:** posterior-update unit tests against hand-computed values; convergence property test (as N→∞, posterior mean → empirical rate regardless of prior); gate-interaction tests (never `calibrated` below sample floor or above max Brier); migration idempotency test. **Docs:** extend `docs/architecture/risk-scoring.md` with the math, the ESS choice, and an updated "what it deliberately is not" section (still no trajectory simulation). **Acceptance:** all existing risk-scoring + perf-budget tests green; the word "Bayesian" in docs now describes shipped math.

### WI-101 · Empirical-Bayes shrinkage across projects
**Priority:** E2 · **Type:** feat(risk-scoring) · **Effort:** M · **Depends:** WI-100

Small per-project sample sizes will dominate early. Add optional hierarchical pooling: estimate global Beta hyperparameters from all projects' `pattern_statistics` (method-of-moments is sufficient; document the choice), and shrink each project's posterior toward the global estimate weighted by its N. Strictly opt-in (`risk_scoring.pooling: true`), local-only (no data leaves the machine; pooling across DB files requires explicit multi-DB config). Same calibration-gate rules apply to pooled outputs.

### WI-102 · ANN vector index to replace the O(n) scan
**Priority:** E2 · **Type:** feat(memory) · **Effort:** L

**Context:** linear cosine scan capped at 10 K embeddings (documented limitation; ANN planned in ROADMAP).
**Design:** (1) prefer `sqlite-vec` extension (keeps single-file story, no new service) behind the existing provider-capability pattern (`StorageProvider` optional method, like `textSearch`); fallback to the current scan when the extension is unavailable — never a hard dependency; (2) index build/backfill as a migration-safe background job triggered by `agentsentry memory reindex`; (3) parity tests: top-k results vs. brute force on a fixture corpus (recall ≥ 0.95 @ k=10); perf test extending `tests/memory/vector-search-perf.test.ts` demonstrating sub-linear scaling to 100 K embeddings; (4) raise the 10 K cap only on the indexed path; update `memory-model.md` Known Limitations. **Acceptance:** graceful fallback verified on a build without the extension; recall + perf tests green.

### WI-103 · Wire the enforcement engine (or remove it)
**Priority:** E2 · **Type:** feat(enforcement) · **Effort:** M

`src/enforcement/engine.ts` (~200 LOC) is implemented + tested but never invoked (quarantined `@experimental`). Shipping dead subsystems erodes trust. **Decide and execute one path:**
- **Wire (recommended):** integrate as an opt-in pre-action check in the MCP tool pipeline (`server.ts` dispatch) and CLI hooks, gated by `enablement` L5+ and config flag `enforcement.enabled`; advisory mode first (log + annotate, never block) → blocking mode behind a second explicit flag; add e2e tests in `tests/e2e/hook-lifecycle.test.ts`.
- **Remove:** delete `src/enforcement/` + tests, record the decision in an ADR (`docs/adr/002-enforcement-removal.md`), keep the git history as the archive.
A third release with it dangling is the worst option.

### WI-104 · Trajectory projection, post-calibration only
**Priority:** E3 (long-horizon) · **Type:** feat(risk-scoring) · **Effort:** XL · **Depends:** WI-100 + accumulated calibration data

`trajectory.ts` is an honest stub returning `available: false`. Implement only when the calibration harness shows `calibrated` basis on the underlying transition estimates: session-topology Markov transitions estimated from `session_topology` data with Dirichlet priors (same ESS discipline as WI-100), Monte-Carlo rollout N steps, output labeled with propagated confidence, and the gate applied to *trajectory-level* forecasts (not just per-step). Keep the current refusal message until every gate passes. Do not start this before WI-100/101 have real-world samples.

### WI-105 · Dashboard user-level access control
**Priority:** E3 · **Type:** feat(dashboard) · **Effort:** L · **Depends:** WI-003

Documented limitation. Minimal viable: named tokens with scopes (`read`, `admin`) stored hashed in config; per-token audit-log entries on access; revocation via CLI (`agentsentry dashboard token create|revoke|list`). Defer full user accounts/SSO to post-1.0. If WI-003 took option (b) for SSE, implement the short-lived HMAC session-token flow (option (a)) here, where the token infrastructure is being built anyway.

### WI-106 · Multi-tenancy namespace column
**Priority:** E3 · **Type:** feat(memory) · **Effort:** M

ROADMAP "future consideration." Add nullable `namespace` column to `ops_events` (migration v6/v7), thread through `MemoryStore` APIs and MCP tool inputs (zod-validated, default null = current behavior), filter all queries by namespace when set. Hash-chain scoping decision required: per-namespace chains (recommended — document in ADR) vs. one global chain. Backward-compat test: existing DBs open and verify unchanged.

### WI-107 · `generate_handoff` auto-hook
**Priority:** E3 · **Type:** feat(cli) · **Effort:** S

ROADMAP "hook integration pending." Wire `src/memory/handoff.ts` into the session-checkpoint hook (`src/cli/hooks/session-checkpoint.ts`) so a handoff document is auto-generated on session end when `context_health` detects high usage; write to the scaffold `CONTEXT.md` per existing templates; opt-out flag.

### WI-108 · Vitest 4 / Node-18-drop migration (deliberate, combined)
**Priority:** E3 · **Type:** chore · **Effort:** M

Deferred consciously (closed PR #38). Execute as one planned breaking release: bump `engines.node` to `>=20`, migrate vitest 2→4 (mock API changes), drop Node 18 from the CI matrix and add 24, note in CHANGELOG as breaking. Do not bundle with feature work. Also clears the dev-only `vitest`/`esbuild` audit criticals noted in the prior plan's Task 3.4 followup.

---

## Suggested Execution Order (v1.2)

```
Wave 0 (preflight):         Ground Rule 0 — fresh branch off origin/main; owner confirms
                            WI-015 item 5 (.claude/ purge recommendation)
Wave 1 (unblock release):   WI-001, WI-002, WI-003, WI-004, WI-005   → tag v0.6.0-beta.2
                            (WI-005 in Wave 1 so the beta.2 publish carries provenance)
Wave 2 (hygiene + docs):    WI-015, WI-017, WI-018, WI-019, WI-021, WI-024*, WI-013
                            (*WI-024 executed by this document; CHANGELOG note at commit)
Wave 3 (hardening):         WI-006, WI-007, WI-008, WI-014, WI-025
Wave 4 (robustness):        WI-009, WI-010, WI-011, WI-012, WI-020, WI-022, WI-016,
                            WI-023, WI-026
Wave 5 (capability):        WI-100 → WI-101, WI-102, WI-103           → 1.0 candidate
Post-1.0:                   WI-104, WI-105, WI-106, WI-107, WI-108
```

**Definition of done, per item:** build + lint (0 warnings after WI-021) + full test suite green; contract tests green; `sync-metadata:check` green; CHANGELOG [Unreleased] entry; docs synced per Ground Rule 6; conventional-commit PR referencing the WI ID.

---

## Corrections to Prior Analysis (for the record)

Claims from earlier review rounds checked against source and **retracted** — do not act on them:
1. "CORS falls back to `*`" — false; `src/mcp/transport.ts:61–66` defaults to `http://localhost` and refuses wildcard without `AGENT_SENTRY_ALLOW_WILDCARD_CORS=1`.
2. "LRU cache is insert-ordered FIFO" — false; `src/memory/cache.ts:61–76` re-inserts on `get()`, which is correct LRU behavior.
3. "`src/mcp/auth.ts` SHA-256-hashes both sides before `timingSafeEqual`" (v1.0's WI-003 text) — false; it length-checks with a dummy compare (`auth.ts:56–63`). WI-003 rewritten accordingly.
4. "Repo has no CI" (earliest review round; documented in the prior plan) — false; CI lives at the monorepo root `.github/workflows/`, not `agent-sentry/.github`.

---

## Dynamic Verification Addendum (executed 2026-07-02, sandbox: Linux arm64, Node v22.22.3, 4 CPU / 3.9 GB)

The static review was subsequently validated by executing the build, full test suite, lint, and benchmarks at baseline commit `1f3e0b9`.

**Results:**

| Check | Result |
|---|---|
| `npm run build` (tsc) | ✅ Clean. Confirms WI-002 empirically: `dist/core/`, `dist/audit/`, `dist/tracing/` dead modules present in output |
| Full test suite (all 126 files, run in 11 chunks) | ✅ **1,558 passed, 0 failed, 15 skipped** (all 15 = Supabase integration/smoke, credential-gated as documented → WI-012) |
| Contract tests | ✅ 20/20 — doc/version drift checks green at baseline |
| Security tests | ✅ All pass (injection, prototype pollution, safe-io attacks, path traversal, enforcement evasion, resource exhaustion) |
| E2E (incl. pack-and-install) | ✅ 30 passed, 4 skipped (Supabase) |
| Performance budget tests | ✅ 5/5 (catastrophe-only thresholds behaved as designed even with a `-O0`-compiled sqlite native module) |
| `npm run lint` | ⚠️ 0 errors, **18 warnings** (FOLLOWUPS says 16 — count is stale; fold correction into WI-021) |
| `npm run benchmark` | ✅ Ran; onnxruntime-node loaded successfully on linux/arm64 |

**Benchmark comparison vs. committed `benchmarks/baseline.json`** (caveat: sandbox sqlite compiled `-O0`; nodejs.org blocked → headers from system):

| Benchmark | Committed baseline (darwin/arm64, 8 CPU) | Sandbox run | Ratio |
|---|---|---|---|
| Insert (single) | 93 ops/s (10.7 ms avg) | 1,827 ops/s (0.55 ms) | ~20x faster |
| Search (keyword) | 49 ops/s (20.3 ms avg) | 1,811 ops/s (0.55 ms) | ~37x faster |
| Insert (batch) | 151 ops/s | 2,154 ops/s | ~14x faster |
| Concurrent R/W | 61 ops/s | 1,789 ops/s | ~29x faster |

The committed baseline is likely capture-condition-skewed — the perf test comments themselves note flakes "on a loaded box". Caveat: darwin fsync/`F_FULLFSYNC` semantics are a real platform difference, not only load noise — a Linux sandbox and a macOS laptop are not directly comparable in either direction. Informational only (the regression test uses hardcoded catastrophe thresholds, not this file), but any doc citing these numbers should carry the platform label.

### WI-023 · Stop `npm run benchmark` from clobbering the committed baseline
**Priority:** P3 · **Type:** fix · **Effort:** XS · **Found by dynamic run**

`scripts/run-benchmark.ts:33–40` unconditionally writes results to `benchmarks/baseline.json` — running the documented `npm run benchmark` command dirties the committed baseline in git (observed). And since `tests/performance/benchmark-regression.test.ts` never reads `baseline.json` (thresholds are hardcoded at lines 32–41), the file's name promises a comparison that doesn't exist. **Changes:** write results to `benchmarks/results-<timestamp>.json` (gitignored) by default; only update `baseline.json` under an explicit `--update-baseline` flag; either make the regression test actually compare against the baseline with generous tolerance, or rename the file `reference-run.json` and document it as informational. Recapture the baseline on a quiet machine **on the platform the docs describe** (the current numbers are darwin/arm64), and embed platform/CPU/Node metadata in the JSON so cross-platform runs are never compared as like-for-like.

**Residual gaps after this addendum** (still open from the "is this exhaustive?" discussion): aggregate coverage % not measured (chunked runs don't merge; CI does this), no fuzzing, no dependency CVE scan beyond `npm audit` config review, no long-run soak of streaming/coordination, GitHub-side settings unverified.
