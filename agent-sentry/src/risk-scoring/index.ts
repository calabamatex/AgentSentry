/**
 * risk-scoring — Context-aware risk scoring with explicit confidence labeling.
 *
 * Public API barrel. See docs/risk-scoring-plan.md for the phased build.
 * Honest framing: deterministic, explainable, confidence-labeled heuristics —
 * not uncalibrated probabilistic prediction. Activated at enablement Level 6.
 */

export * from './types';
export { DEFAULT_RISK_SCORING_CONFIG } from './constants';
export { RiskScoringEngine, type LiveSignals } from './engine';
export { SessionTopology } from './knowledge/session-topology';
export { RiskCorrelator } from './correlation/correlator';
export { DeterministicScorer } from './scoring/deterministic';
export { evaluateGate, buildConfidence } from './calibration/gate';
export {
  brierScore,
  reliabilityDiagram,
  expectedCalibrationError,
  type Prediction,
} from './calibration/metrics';
