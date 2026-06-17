# Context-Aware Risk Scoring (Level 6) — Execution Plan

**Status:** Planning → in progress (Phase A)
**Framing:** Ship **context-aware risk scoring with explicit confidence labeling** — deterministic, explainable heuristics — **not** "probabilistic threat intelligence with prediction." This plan is the honest, scoped re-cut of the original "Threat Evaluation Engine" spec.

## Why this re-cut

The original spec dressed hand-tuned heuristics in probabilistic language ("Bayesian", "Monte Carlo", "0.68 probability of incident") and shipped predictions that, for almost every real user, run on seed constants until 100+ same-DB sessions calibrate them. For a *safety* tool, miscalibrated confidence is worse than an honest binary check. It was also built on a stale baseline (v4.0 / 1042 tests / 9 tools). This plan fixes the baseline and makes every numeric output defensible on day one.

**Verified current baseline (`origin/main`):** version `0.6.0-beta.1`; **10** MCP tools today; migrations are `migration-vN.ts` registered in `src/memory/migrations/sqlite-migrations.ts` (next = **v5**, not `005-*`); config schema in `src/config/resolve.ts` (+ CLI in `src/cli/commands/config.ts`); enablement in `src/enablement/engine.ts` (`ALL_SKILLS`, `generateConfigForLevel`, level-cap guard); reusable primitives: `secret-detection`, `context-estimation`, `risk-scoring`, `rules-validation`. The doc-contract test (`tests/contracts/doc-contracts.test.ts`) extracts the `tools` array and asserts README "N tools" matches — so the surface goes **10 → 11** and README must move in the same PR.

## Four hard gates (the spine)

1. **Baseline-correct** before any code (version, 10→11 tools, real paths, Level-6 enablement wiring that keeps `validateLevelMatchesSkills` + doc-contract tests green).
2. **Validation/calibration harness exists before any probability is emitted** (Brier score + reliability diagram against labeled fixtures). No score ships uncalibrated.
3. **Confidence-label everything** at the type level — low sample size ⇒ output tagged `default_priors`, enforced by a CI test. The "0.68 with no data" failure mode is impossible by construction.
4. **Park prediction** — Monte Carlo stays `@experimental`, off by default, gated on a reliability diagram current data cannot pass. Marketing matches code.

## Scope & conventions

- **Estimate:** ~1,400–1,900 LOC source + ~1,800–2,400 LOC tests.
- **One PR per phase** (`feat/risk-scoring-A … -G`), each CI-green (Node 18/20/22 + security + lint + doc-validation + smoke), additive, opt-in, **zero regression at Levels 1–5**.
- Module lives at `src/risk-scoring/` (named for the honest framing, not "threat-eval").
- Reuse primitives; never fork existing detection logic.
- New tests drive a **real in-memory store** (the de-mock pattern from PR #24), not stub-asserting.
- Deterministic: no `Math.random` in scoring; fake timers for time math (avoid the flake class fixed in PR #21).

---

## Phase A — Honest foundation & guardrails (Gate 1)

- **A1.** Correct baseline facts in any kept docs (version, live test count, 10→11 tools).
- **A2.** Scaffold `src/risk-scoring/`: `index.ts`, `types.ts`, `constants.ts`, `engine.ts`, `knowledge/`, `scoring/`, `correlation/`, `calibration/` (empty exports; `npm run build` green).
- **A3.** `types.ts` + Zod: knowledge-store/result interfaces, **plus a mandatory `confidence: { value: number; basis: 'default_priors' | 'calibrated'; sample_size: number }` on every scored output.** No interface may emit a bare probability.
- **A4.** `migration-v5.ts` (additive tables `risk_patterns`, `misbehavior_profiles`, `risk_scores`, `pattern_statistics`); register in `sqlite-migrations.ts`; idempotent `up()`/`down()`; seed catalog.
- **A5.** Extend config Zod schema in `src/config/resolve.ts` with `risk_scoring` (`enabled: false` default; backward-compatible when absent).
- **A6.** Level 6 enablement done right: extend `ALL_SKILLS` + `skills` interface with `risk_scoring`; extend `generateConfigForLevel` (raise `level > 5` guard to 6, map L6 skills); update README level table + `agent-sentry.config.json` default so `validateLevelMatchesSkills` and the README-default doc-contract test stay green.

**Gate 1:** `npm test` fully green incl. doc-contracts; `enable 6` satisfies `validateLevelMatchesSkills`; Levels 1–5 unchanged.

## Phase B — Validation & calibration harness FIRST (Gate 2)

- **B1.** Labeled-outcome fixtures (`tests/risk-scoring/fixtures/`): synthetic sessions with ground-truth incident / no-incident labels across categories.
- **B2.** Calibration metrics (`calibration/metrics.ts`): Brier score, reliability-diagram bucketing, base-rate comparison. Pure, unit-tested.
- **B3.** Calibration gate test: any scorer claiming `basis: 'calibrated'` must meet a Brier threshold on fixtures, else downgrade to `default_priors`. A deliberately-bad scorer must fail the gate (gate has teeth).

**Gate 2:** harness runs in CI; bad scorer fails.

## Phase C — Deterministic, honest core (the real v1 value)

- **C1.** `knowledge/session-topology.ts`: in-memory session state, no DB during updates; derived queries; fake-timer tests for time math.
- **C2.** `knowledge/pattern-library.ts` + `constants.ts`: 10 patterns; scoring = **deterministic context modifiers** (test-file ×0.2, prod-config ×1.0). Import `secret-detection`/`context-estimation`/`risk-scoring`/`rules-validation` — do not duplicate.
- **C3.** `correlation/correlator.ts`: 5 compound rules (Blind Bulldozing, etc.) — boolean conditions + bounded severity boost + human-readable explanation. The centerpiece (explainable, no statistics).
- **C4.** Composite score = transparent weighted max of (context-adjusted severities, compound boosts); confidence `calibrated` only if Phase B passed for that input class, else `default_priors`.

## Phase D — Confidence-labeled statistical layer (Gate 3, scoped)

- **D1.** `scoring/bayesian.ts`: modest posterior update, **every output confidence-tagged**; `sample_size < min` ⇒ return Phase-C deterministic score with `default_priors` + visible "running on defaults" note.
- **D2.** `calibration/calibrator.ts`: EMA (α≈0.2) over `pattern_statistics`; flips to `calibrated` only once Phase-B thresholds met; background, non-blocking.
- **D3.** CI honesty test: low-N ⇒ `default_priors`; sufficient-N calibrated fixture ⇒ `calibrated` and passes Brier gate.

**Gate 3:** no path emits a `calibrated` probability that hasn't passed the calibration gate.

## Phase E — MCP / CLI / dashboard surface (lockstep with doc-contracts)

- **E1.** New tool `agent_sentry_risk_score` (`src/mcp/tools/risk-score.ts`), registered in `src/mcp/server.ts` only when `risk_scoring.enabled`. Update README **11 tools** + tables in the same PR.
- **E2.** Enhance `health` + `scan_security` with additive optional fields at Level 6 only; existing tests unchanged; new tests use a real store.
- **E3.** Wire `capture_event` → `engine.onEvent` at Level 6; real-store test treatment.
- **E4.** Dashboard panel (conditional at L6): risk gauge, **confidence badge** (default vs calibrated), compound-risk alerts, explanations. No trajectory chart in v1.
- **E5.** CLI `health`/`metrics` show risk + calibration state at L6; unchanged at L1–5.

**Gate:** tool count 11 verified by doc-contract; Level 5 unchanged.

## Phase F — Park the prediction story (Gate 4)

- **F1.** Monte Carlo implemented only as a documented `@experimental`, off-by-default stub (mirrors `enforcement`/`coordination` labeling), gated behind a reliability check current data can't pass. README/ROADMAP: "experimental — not calibrated; not for decisions."
- **F2.** Rewrite narrative/marketing docs to match what ships ("context-aware heuristic scoring with explicit confidence"), not "predictive trajectory / category that doesn't exist / EU AI Act statistical backing."

**Gate 4:** no shipped surface claims predictive validity; marketing matches code.

## Phase G — Backward-compat, performance, release

- **G1.** Backward-compat suite: L1–5 byte-identical; config without `risk_scoring` loads; downgrade L6→L5 clean.
- **G2.** Perf benchmarks with **conservative thresholds** (lesson from the perf-flake fixed in PR #22): `performance.now()`, isolated benchmark job.
- **G3.** Final gate: build + lint + `tsc` clean; full suite green; doc-contract green (11 tools, L6 tables, version); calibration gate green; coverage floors (PR #20) hold.

---

## Dependency order

```
A (foundation) → B (calibration harness) → C (deterministic core)
                                              → D (confidence-labeled stats) → E (surface)
                                                                                 → F (park prediction)
                                                                                    → G (compat/perf/release)
```

## The two decisions that make this honest

1. **Ordering:** the validation harness (Phase B) precedes any probability.
2. **Type-level confidence:** every scored output *must* carry a confidence basis (A3), enforced in CI — so "impressive but unverifiable" becomes "honest and defensible."
