/**
 * risk-scoring — Context-aware risk scoring with explicit confidence labeling.
 *
 * Public API barrel. See docs/risk-scoring-plan.md for the phased build.
 * Honest framing: deterministic, explainable, confidence-labeled heuristics —
 * not uncalibrated probabilistic prediction. Activated at enablement Level 6.
 */

export * from './types';
export { DEFAULT_RISK_SCORING_CONFIG } from './constants';
