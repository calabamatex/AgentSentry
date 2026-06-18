/**
 * constants.ts — Default configuration for risk scoring.
 *
 * The pattern / misbehavior-profile catalogs (DEFAULT_RISK_PATTERNS,
 * DEFAULT_MISBEHAVIOR_PROFILES, COMPOUND_RISK_RULES) land in Phase C alongside
 * the knowledge stores that consume them. This file currently holds only the
 * config defaults, which the config loader (Phase A) needs now.
 */

import { RiskScoringConfigSchema, type RiskScoringConfig, type MisbehaviorProfile } from './types';

/** Canonical default config — risk scoring is OFF unless Level 6 is enabled. */
export const DEFAULT_RISK_SCORING_CONFIG: RiskScoringConfig = RiskScoringConfigSchema.parse({
  enabled: false,
});

/**
 * Five behavioral failure-mode profiles. `base_likelihood` values are
 * hand-authored PRIORS — heuristic starting points, explicitly not measured.
 * Until a project accumulates calibration data, profile likelihoods are
 * reported as `default_priors`.
 */
export const DEFAULT_MISBEHAVIOR_PROFILES: MisbehaviorProfile[] = [
  {
    id: 'MBP-HALLUCINATOR',
    name: 'The Hallucinator',
    description: 'Operating on degraded context, making confident but possibly incorrect changes.',
    preconditions: [
      { type: 'context_utilization_above', threshold: 0.75, weight: 0.5 },
      { type: 'session_duration_above', threshold: 60, weight: 0.25 },
      { type: 'error_count_above', threshold: 2, weight: 0.25 },
    ],
    signals: [],
    potential_damage: [{ type: 'code_quality', severity: 0.6, reversibility: 'moderate' }],
    typical_blast_radius: 'module',
    base_likelihood: 0.1,
    precondition_multipliers: {},
    observed_frequency: 0,
    recommended_action: 'Reduce context load: summarize and start a fresh session before making more edits.',
  },
  {
    id: 'MBP-SCOPE-CREEPER',
    name: 'The Scope Creeper',
    description: 'Expanding beyond the declared task into unrelated modules.',
    preconditions: [
      { type: 'files_touched_above', threshold: 8, weight: 0.5 },
      { type: 'session_duration_above', threshold: 45, weight: 0.25 },
    ],
    signals: [],
    potential_damage: [{ type: 'time_waste', severity: 0.5, reversibility: 'moderate' }],
    typical_blast_radius: 'project',
    base_likelihood: 0.12,
    precondition_multipliers: {},
    observed_frequency: 0,
    recommended_action: 'Re-state the task scope and split unrelated changes into separate sessions.',
  },
  {
    id: 'MBP-SECRET-SPILLER',
    name: 'The Secret Spiller',
    description: 'At risk of exposing credentials via commits or generated code.',
    preconditions: [
      { type: 'context_utilization_above', threshold: 0.7, weight: 0.4 },
      { type: 'files_touched_above', threshold: 3, weight: 0.2 },
    ],
    signals: [],
    potential_damage: [{ type: 'security_exposure', severity: 0.9, reversibility: 'difficult' }],
    typical_blast_radius: 'cross_project',
    base_likelihood: 0.05,
    precondition_multipliers: {},
    observed_frequency: 0,
    recommended_action: 'Scan touched files for secrets and verify nothing sensitive is staged before committing.',
  },
  {
    id: 'MBP-BULLDOZER',
    name: 'The Bulldozer',
    description: 'Making large changes without incremental checkpoints.',
    preconditions: [
      { type: 'time_since_commit_above', threshold: 45, weight: 0.5 },
      { type: 'files_touched_above', threshold: 10, weight: 0.5 },
    ],
    signals: [],
    potential_damage: [{ type: 'data_loss', severity: 0.7, reversibility: 'difficult' }],
    typical_blast_radius: 'project',
    base_likelihood: 0.15,
    precondition_multipliers: {},
    observed_frequency: 0,
    recommended_action: 'Commit current work as a checkpoint and decompose the remaining task.',
  },
  {
    id: 'MBP-LOOP-RUNNER',
    name: 'The Loop Runner',
    description: 'Repeating failed approaches, burning context and budget without progress.',
    preconditions: [
      { type: 'error_count_above', threshold: 3, weight: 0.6 },
      { type: 'session_duration_above', threshold: 30, weight: 0.2 },
    ],
    signals: [],
    potential_damage: [{ type: 'cost_overrun', severity: 0.6, reversibility: 'easy' }],
    typical_blast_radius: 'module',
    base_likelihood: 0.1,
    precondition_multipliers: {},
    observed_frequency: 0,
    recommended_action: 'Step back and change approach — the current path is not converging.',
  },
];
