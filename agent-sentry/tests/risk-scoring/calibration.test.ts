/**
 * calibration.test.ts — Phase B: metrics + the calibration gate.
 *
 * The load-bearing test is "the gate has teeth": a confidently-wrong scorer
 * must be refused the 'calibrated' label. This is what stops the engine from
 * ever emitting an uncalibrated number dressed as a probability.
 */

import { describe, it, expect } from 'vitest';
import {
  brierScore,
  baseRate,
  baseRateBrier,
  reliabilityDiagram,
  expectedCalibrationError,
} from '../../src/risk-scoring/calibration/metrics';
import { evaluateGate, buildConfidence } from '../../src/risk-scoring/calibration/gate';
import { DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';
import {
  CALIBRATED_SET,
  MISCALIBRATED_SET,
  TINY_SET,
} from './fixtures/calibration-fixtures';

const cfg = DEFAULT_RISK_SCORING_CONFIG;

describe('calibration metrics', () => {
  it('brierScore is 0 for a perfect forecaster', () => {
    expect(brierScore([{ forecast: 1, outcome: true }, { forecast: 0, outcome: false }])).toBe(0);
  });

  it('brierScore is 1 for a confidently-wrong forecaster', () => {
    expect(brierScore([{ forecast: 1, outcome: false }, { forecast: 0, outcome: true }])).toBe(1);
  });

  it('brierScore is low for the calibrated set, high for the miscalibrated set', () => {
    expect(brierScore(CALIBRATED_SET)).toBeLessThan(0.25);
    expect(brierScore(MISCALIBRATED_SET)).toBeGreaterThan(0.5);
  });

  it('baseRate reflects the fraction of positives', () => {
    expect(baseRate(CALIBRATED_SET)).toBeCloseTo(0.5, 1); // 50/100
  });

  it('baseRateBrier is the naive reference score', () => {
    // base rate 0.5 → naive Brier = 0.25
    expect(baseRateBrier(CALIBRATED_SET)).toBeCloseTo(0.25, 2);
  });

  it('reliabilityDiagram: observed frequency ≈ forecast in each populated bin (calibrated)', () => {
    const bins = reliabilityDiagram(CALIBRATED_SET, 10);
    for (const b of bins) {
      if (b.count === 0) continue;
      expect(Math.abs(b.meanForecast - b.observedFrequency)).toBeLessThan(0.05);
    }
  });

  it('expectedCalibrationError is small for calibrated, large for miscalibrated', () => {
    expect(expectedCalibrationError(CALIBRATED_SET)).toBeLessThan(0.05);
    expect(expectedCalibrationError(MISCALIBRATED_SET)).toBeGreaterThan(0.5);
  });

  it('handles empty input without throwing', () => {
    expect(Number.isNaN(brierScore([]))).toBe(true);
    expect(reliabilityDiagram([], 5)).toHaveLength(5);
  });
});

describe('calibration gate', () => {
  it('passes a calibrated set with enough samples', () => {
    const v = evaluateGate(CALIBRATED_SET, cfg);
    expect(v.passes).toBe(true);
    expect(v.brier).toBeLessThan(0.25);
  });

  it('THE GATE HAS TEETH: refuses a confidently-wrong scorer', () => {
    const v = evaluateGate(MISCALIBRATED_SET, cfg);
    expect(v.passes).toBe(false);
    expect(v.reason).toMatch(/brier/);
  });

  it('refuses calibration with too few samples', () => {
    const v = evaluateGate(TINY_SET, cfg);
    expect(v.passes).toBe(false);
    expect(v.reason).toMatch(/insufficient samples/);
  });
});

describe('buildConfidence (honesty enforcement)', () => {
  it('labels a passing scorer "calibrated" and preserves trust', () => {
    const c = buildConfidence(0.8, CALIBRATED_SET, cfg);
    expect(c.basis).toBe('calibrated');
    expect(c.value).toBe(0.8);
    expect(c.sample_size).toBe(CALIBRATED_SET.length);
  });

  it('downgrades a failing scorer to "default_priors" and caps confidence at 0.5', () => {
    const c = buildConfidence(0.9, MISCALIBRATED_SET, cfg);
    expect(c.basis).toBe('default_priors');
    expect(c.value).toBeLessThanOrEqual(0.5);
  });

  it('treats zero evidence as default_priors', () => {
    const c = buildConfidence(0.9, [], cfg);
    expect(c.basis).toBe('default_priors');
    expect(c.value).toBeLessThanOrEqual(0.5);
    expect(c.sample_size).toBe(0);
  });
});
