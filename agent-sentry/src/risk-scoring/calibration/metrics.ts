/**
 * metrics.ts — Calibration metrics for risk scoring.
 *
 * These are the measuring instruments that decide whether a score is allowed
 * to call itself 'calibrated'. A probability is only meaningful if, across many
 * predictions, things predicted at 0.7 actually happen ~70% of the time. Until
 * we can show that against labeled outcomes, scores stay 'default_priors'.
 *
 * Pure functions, no I/O.
 */

/** A single forecast paired with what actually happened. */
export interface Prediction {
  /** Forecast probability in [0, 1]. */
  forecast: number;
  /** Ground-truth outcome: did the predicted event occur? */
  outcome: boolean;
}

/**
 * Brier score: mean squared error between forecast probabilities and outcomes.
 * Range [0, 1]; lower is better. 0 = perfect, 0.25 = a coin flip (forecast 0.5),
 * up to 1 = confidently wrong. A useful, strictly-proper scoring rule.
 */
export function brierScore(predictions: Prediction[]): number {
  if (predictions.length === 0) return Number.NaN;
  let sum = 0;
  for (const p of predictions) {
    const o = p.outcome ? 1 : 0;
    const f = clamp01(p.forecast);
    sum += (f - o) * (f - o);
  }
  return sum / predictions.length;
}

/** Observed base rate — fraction of outcomes that were true. */
export function baseRate(predictions: Prediction[]): number {
  if (predictions.length === 0) return Number.NaN;
  let trues = 0;
  for (const p of predictions) if (p.outcome) trues++;
  return trues / predictions.length;
}

/**
 * Reference Brier score of the naive "always predict the base rate" forecaster.
 * A model that can't beat this is not adding information.
 */
export function baseRateBrier(predictions: Prediction[]): number {
  if (predictions.length === 0) return Number.NaN;
  const br = baseRate(predictions);
  return brierScore(predictions.map((p) => ({ forecast: br, outcome: p.outcome })));
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanForecast: number; // mean predicted probability in this bin
  observedFrequency: number; // actual fraction of positives in this bin
}

/**
 * Reliability diagram data: bucket forecasts into `bins` equal-width buckets and
 * report, per bucket, the mean forecast vs. the observed positive frequency.
 * For a well-calibrated model, meanForecast ≈ observedFrequency in every bin.
 */
export function reliabilityDiagram(predictions: Prediction[], bins = 10): ReliabilityBin[] {
  const width = 1 / bins;
  const out: ReliabilityBin[] = [];
  for (let i = 0; i < bins; i++) {
    const lower = i * width;
    const upper = i === bins - 1 ? 1 : (i + 1) * width;
    const inBin = predictions.filter((p) => {
      const f = clamp01(p.forecast);
      // last bin is inclusive of 1.0
      return f >= lower && (i === bins - 1 ? f <= upper : f < upper);
    });
    const count = inBin.length;
    const meanForecast = count === 0 ? Number.NaN : inBin.reduce((s, p) => s + clamp01(p.forecast), 0) / count;
    const observedFrequency = count === 0 ? Number.NaN : baseRate(inBin);
    out.push({ lower, upper, count, meanForecast, observedFrequency });
  }
  return out;
}

/**
 * Expected Calibration Error (ECE): the average gap between confidence and
 * accuracy, weighted by bin population. 0 = perfectly calibrated.
 */
export function expectedCalibrationError(predictions: Prediction[], bins = 10): number {
  if (predictions.length === 0) return Number.NaN;
  const diagram = reliabilityDiagram(predictions, bins);
  let ece = 0;
  for (const b of diagram) {
    if (b.count === 0) continue;
    ece += (b.count / predictions.length) * Math.abs(b.meanForecast - b.observedFrequency);
  }
  return ece;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
