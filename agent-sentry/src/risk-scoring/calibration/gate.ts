/**
 * gate.ts — The calibration gate.
 *
 * This is the runtime half of the honesty guarantee (the type half is the
 * mandatory `Confidence` on every scored output). A score may only be labeled
 * 'calibrated' if it has BOTH enough observations AND a Brier score at or below
 * the configured ceiling on labeled outcomes. Otherwise it is 'default_priors':
 * a heuristic hint, explicitly not a measured probability.
 *
 * Nothing in the engine should construct a `Confidence` by hand — everything
 * goes through `buildConfidence` so the gate cannot be bypassed.
 */

import type { Confidence, RiskScoringConfig } from '../types';
import { brierScore, type Prediction } from './metrics';

export interface CalibrationVerdict {
  passes: boolean;
  brier: number;
  sampleSize: number;
  reason: string;
}

/**
 * Evaluate whether a body of labeled predictions clears the calibration gate.
 */
export function evaluateGate(
  predictions: Prediction[],
  config: Pick<RiskScoringConfig, 'calibration'>,
): CalibrationVerdict {
  const sampleSize = predictions.length;
  const minSamples = config.calibration.minimum_samples_for_calibration;
  const maxBrier = config.calibration.max_brier_score;

  if (sampleSize < minSamples) {
    return {
      passes: false,
      brier: Number.NaN,
      sampleSize,
      reason: `insufficient samples (${sampleSize} < ${minSamples})`,
    };
  }

  const brier = brierScore(predictions);
  if (Number.isNaN(brier) || brier > maxBrier) {
    return {
      passes: false,
      brier,
      sampleSize,
      reason: `brier ${brier.toFixed(3)} exceeds ceiling ${maxBrier}`,
    };
  }

  return { passes: true, brier, sampleSize, reason: 'calibrated' };
}

/**
 * Build a `Confidence` for a raw heuristic trust value, applying the gate.
 *
 * @param rawTrust    Heuristic trust in [0,1] (e.g. evidence-quantity based).
 * @param predictions Labeled outcomes for THIS input class (empty = pure prior).
 * @param config      Risk-scoring config (calibration thresholds).
 *
 * If the gate passes, basis='calibrated' and the confidence value is allowed to
 * reflect rawTrust. If it fails, basis='default_priors' and the value is capped
 * so a default-prior score can never masquerade as high-confidence.
 */
export function buildConfidence(
  rawTrust: number,
  predictions: Prediction[],
  config: Pick<RiskScoringConfig, 'calibration'>,
): Confidence {
  const verdict = evaluateGate(predictions, config);
  const trust = clamp01(rawTrust);

  if (verdict.passes) {
    return { value: trust, basis: 'calibrated', sample_size: verdict.sampleSize };
  }

  // Default priors: cap confidence at 0.5 — heuristics are hints, not measurements.
  return {
    value: Math.min(trust, 0.5),
    basis: 'default_priors',
    sample_size: verdict.sampleSize,
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
