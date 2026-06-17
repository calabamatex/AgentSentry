/**
 * calibration-fixtures.ts — Deterministic labeled-outcome fixtures.
 *
 * No randomness: each "bucket" pins exactly how many of N predictions at a given
 * forecast actually came true, so calibration metrics are reproducible.
 */

import type { Prediction } from '../../../src/risk-scoring/calibration/metrics';

/** N predictions at `forecast`, of which the first `trueCount` have outcome=true. */
export function bucket(forecast: number, count: number, trueCount: number): Prediction[] {
  return Array.from({ length: count }, (_, i) => ({ forecast, outcome: i < trueCount }));
}

/**
 * Well-calibrated set: observed frequency in each bucket matches its forecast.
 * 0.1→10%, 0.3→30%, 0.5→50%, 0.7→70%, 0.9→90%. Low Brier, low ECE.
 */
export const CALIBRATED_SET: Prediction[] = [
  ...bucket(0.1, 20, 2),
  ...bucket(0.3, 20, 6),
  ...bucket(0.5, 20, 10),
  ...bucket(0.7, 20, 14),
  ...bucket(0.9, 20, 18),
];

/**
 * Miscalibrated set: confidently wrong. Forecasts 0.9 when only 10% occur and
 * 0.1 when 90% occur. High Brier — must fail the gate.
 */
export const MISCALIBRATED_SET: Prediction[] = [
  ...bucket(0.9, 50, 5),
  ...bucket(0.1, 50, 45),
];

/** Too few observations to calibrate against (below default minimum of 20). */
export const TINY_SET: Prediction[] = [
  ...bucket(0.7, 3, 2),
];
