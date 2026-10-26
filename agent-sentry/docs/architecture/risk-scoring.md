# Risk Scoring (Level 6) — Architecture

**Status:** experimental (opt-in at enablement Level 6). Activated by `agent-sentry enable --level 6`.

Context-aware risk scoring upgrades AgentSentry's binary checks into a **deterministic, explainable, confidence-labeled** risk read. It is **not** a probabilistic prediction system — see [What it deliberately is *not*](#what-it-deliberately-is-not).

## The one rule

Every scored number travels with a `Confidence`:

```ts
confidence: { value: number; basis: 'default_priors' | 'calibrated'; sample_size: number }
```

- **`default_priors`** — the score is a transform of hand-authored seed values. It is a heuristic hint, **not** validated against outcomes. Confidence is capped at 0.5.
- **`calibrated`** — the score has passed the calibration gate against labeled outcomes for this input class.

Until a project accumulates labeled outcomes, **everything is `default_priors`**. This is enforced two ways: at the type level (no scored type can omit `Confidence`) and at runtime (`buildConfidence()` is the single choke point, and the calibration gate decides the basis).

## Components

| Component | What it does |
|---|---|
| `knowledge/session-topology.ts` | In-memory per-session state (files, context utilization, commit gap, error rate, directories). Injectable clock → deterministic. |
| `knowledge/misbehavior-profiles.ts` | Five behavioral failure-mode profiles via **deterministic precondition matching**; bounded likelihood over a prior. |
| `correlation/correlator.ts` | Five **transparent compound-risk rules** (boolean conditions + bounded severity boost + explanation). The centerpiece. |
| `scoring/deterministic.ts` | Transparent composite score (topology base risk + compound boosts). |
| `calibration/` | Brier score, reliability diagram, ECE, and the **gate** that decides `calibrated` vs `default_priors`. |
| `engine.ts` | Orchestrates the above; built per call from a session's stored events + optional live signals. |
| MCP tool `agent_sentry_risk_score` | The reachable surface (Level-6 gated). |

## Data flow

```
session events + live signals
        │
        ▼
   SessionTopology  ──►  RiskCorrelator (compound rules)
        │                MisbehaviorProfileStore (precondition match)
        ▼                        │
   DeterministicScorer ◄─────────┘
        │
        ▼   buildConfidence() ──► calibration gate
   RiskScore { level, compound_risks, active_profiles, confidence, explanation }
```

## What it deliberately is *not*

- **No trajectory / Monte-Carlo prediction.** See `scoring/trajectory.ts`: forward simulation over un-calibrated transition probabilities would emit confident-but-unvalidated numbers ("0.68 probability of incident"). For a safety tool, miscalibrated confidence is worse than none. It will ship only after the calibration harness proves it reliable.
- **No "Bayesian posterior" presented as a measured probability.** Profile likelihoods are bounded heuristic updates over priors, labeled `default_priors`.
- **No claim of predictive validity** on any shipped surface. The README and ROADMAP mark risk scoring `[experimental]`.

## Calibration over time

The pattern-statistics tables accumulate outcomes. Once enough labeled samples exist and a scorer beats the Brier-score ceiling on them, that scorer's outputs flip to `basis: 'calibrated'`. Statistics are per-project; a fresh project starts on defaults.
