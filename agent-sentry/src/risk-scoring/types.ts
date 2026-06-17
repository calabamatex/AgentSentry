/**
 * types.ts — Type surface for context-aware risk scoring (Level 6).
 *
 * Design rule (enforced by tests): every *scored* output carries a mandatory
 * `Confidence`. There is no way to emit a bare probability — a number must
 * always travel with its basis (default priors vs. calibrated) and the sample
 * size behind it. This is the type-level half of the honesty guarantee; the
 * runtime half is the calibration gate (Phase B).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Confidence — mandatory companion to every scored number
// ---------------------------------------------------------------------------

/**
 * `basis` is the load-bearing field:
 *  - 'default_priors' — the score is a transform of hand-authored seed values;
 *    NOT validated against outcomes. Treat as a heuristic hint, not a measurement.
 *  - 'calibrated' — the score has passed the calibration gate (Phase B) against
 *    labeled outcomes for this input class. Only then may a number be presented
 *    as a probability.
 */
export interface Confidence {
  value: number; // 0..1 — how much to trust the accompanying score
  basis: 'default_priors' | 'calibrated';
  sample_size: number; // observations behind the estimate (0 = pure prior)
}

export const ConfidenceSchema = z.object({
  value: z.number().min(0).max(1),
  basis: z.enum(['default_priors', 'calibrated']),
  sample_size: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Risk patterns (catalog)
// ---------------------------------------------------------------------------

export type RiskCategory =
  | 'secret_leak'
  | 'dangerous_code'
  | 'scope_violation'
  | 'context_degradation'
  | 'checkpoint_gap'
  | 'permission_breach'
  | 'cost_overrun'
  | 'rule_violation'
  | 'oversized_change'
  | 'cascading_error';

export interface ContextCondition {
  [key: string]: string | number | boolean;
}

export interface ContextModifier {
  condition: ContextCondition;
  severity_multiplier: number;
  false_positive_adjustment: number;
}

export interface RiskPattern {
  id: string;
  name: string;
  category: RiskCategory;
  detection_method: 'regex' | 'heuristic' | 'threshold' | 'composite';
  detection_config: Record<string, unknown>;
  base_severity: number;
  false_positive_rate: number;
  context_modifiers: ContextModifier[];
  historical_frequency: number;
  correlated_patterns: string[];
  escalation_chain: string[];
}

// ---------------------------------------------------------------------------
// Misbehavior profiles
// ---------------------------------------------------------------------------

export interface SessionCondition {
  type:
    | 'context_utilization_above'
    | 'time_since_commit_above'
    | 'files_touched_above'
    | 'error_count_above'
    | 'session_duration_above'
    | 'module_has_history';
  threshold: number;
  weight: number;
}

export interface SignalDefinition {
  risk_pattern_id: string;
  minimum_occurrences: number;
  time_window_minutes: number;
}

export interface DamageVector {
  type: 'data_loss' | 'security_exposure' | 'code_quality' | 'time_waste' | 'cost_overrun';
  severity: number;
  reversibility: 'easy' | 'moderate' | 'difficult' | 'irreversible';
}

export interface MisbehaviorProfile {
  id: string;
  name: string;
  description: string;
  preconditions: SessionCondition[];
  signals: SignalDefinition[];
  potential_damage: DamageVector[];
  typical_blast_radius: 'single_file' | 'module' | 'project' | 'cross_project';
  base_likelihood: number;
  precondition_multipliers: Record<string, number>;
  observed_frequency: number;
}

// ---------------------------------------------------------------------------
// Compound risk
// ---------------------------------------------------------------------------

export interface CompoundRiskRule {
  id: string;
  description: string;
  signals: string[]; // condition keys, all must hold
  severity_boost: number;
}

export interface CompoundRisk {
  id: string;
  description: string;
  individual_signals: string[];
  compound_severity: number;
  exceeds_individual_max_by: number;
}

// ---------------------------------------------------------------------------
// Scored output — the aggregate (note the mandatory Confidence)
// ---------------------------------------------------------------------------

export interface ActiveThreat {
  pattern_id: string;
  name: string;
  severity: number; // context-adjusted, deterministic
  confidence: Confidence;
  contributing_algorithms: string[];
}

export interface ActiveProfile {
  profile_id: string;
  name: string;
  likelihood: number;
  confidence: Confidence;
  matched_preconditions: string[];
  recommended_action: string;
}

export interface RiskScore {
  session_risk_level: number; // 0..1 composite
  risk_trend: 'stable' | 'increasing' | 'decreasing' | 'volatile';
  /** Confidence in the composite score — the single most important field. */
  confidence: Confidence;
  active_threats: ActiveThreat[];
  active_profiles: ActiveProfile[];
  compound_risks: CompoundRisk[];
  algorithms_run: string[];
  algorithms_skipped: string[];
  total_execution_time_ms: number;
  evaluation_timestamp: string;
  /** Human-readable, plain explanation. Always present — scores are explainable. */
  explanation: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const RiskScoringConfigSchema = z.object({
  enabled: z.boolean().default(false),
  correlation: z
    .object({
      enabled: z.boolean().default(true),
      compound_risk_threshold: z.number().min(0).max(1).default(0.15),
    })
    .default({ enabled: true, compound_risk_threshold: 0.15 }),
  performance: z
    .object({
      max_evaluation_time_ms: z.number().int().positive().default(100),
    })
    .default({ max_evaluation_time_ms: 100 }),
  calibration: z
    .object({
      // Below this sample size, scores are reported as 'default_priors'.
      minimum_samples_for_calibration: z.number().int().min(1).default(20),
      // Brier-score ceiling a scorer must beat to claim 'calibrated'.
      max_brier_score: z.number().min(0).max(1).default(0.25),
    })
    .default({ minimum_samples_for_calibration: 20, max_brier_score: 0.25 }),
});

export type RiskScoringConfig = z.infer<typeof RiskScoringConfigSchema>;
