/**
 * trajectory.test.ts — Phase F: enforces that trajectory prediction is deferred.
 *
 * These tests are guardrails: they fail if someone later ships a fabricated
 * trajectory probability without going through calibration.
 */

import { describe, it, expect } from 'vitest';
import { projectTrajectory } from '../../src/risk-scoring/scoring/trajectory';
import { RiskScoringEngine } from '../../src/risk-scoring/engine';
import { DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';

describe('trajectory projection (deferred)', () => {
  it('reports not available with an explicit reason', () => {
    const t = projectTrajectory();
    expect(t.available).toBe(false);
    expect(t.reason).toMatch(/experimental|calibrat/i);
  });

  it('RiskScore does NOT expose a predictive trajectory field', () => {
    const e = new RiskScoringEngine(DEFAULT_RISK_SCORING_CONFIG, 's1', () => 1_000_000);
    const score = e.evaluate('2026-01-01T00:00:00.000Z') as Record<string, unknown>;
    // No "0.68 probability of incident in N steps" surface in shipped output.
    expect(score).not.toHaveProperty('trajectory');
    expect(score).not.toHaveProperty('incident_probability');
    expect(score).not.toHaveProperty('expected_steps_to_incident');
  });
});
