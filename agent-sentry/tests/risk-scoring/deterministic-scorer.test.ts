/**
 * deterministic-scorer.test.ts — Phase C: composite deterministic score.
 */

import { describe, it, expect } from 'vitest';
import { DeterministicScorer } from '../../src/risk-scoring/scoring/deterministic';
import { SessionTopology } from '../../src/risk-scoring/knowledge/session-topology';
import { DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';
import type { CorrelationSignals } from '../../src/risk-scoring/correlation/correlator';
import {
  CALIBRATED_SET,
  MISCALIBRATED_SET,
} from './fixtures/calibration-fixtures';

const cfg = DEFAULT_RISK_SCORING_CONFIG;
const TS = '2026-01-01T00:00:00.000Z';

function fakeClock(start = 1_000_000) {
  let t = start;
  return { clock: () => t, advanceMinutes: (m: number) => { t += m * 60000; } };
}
function noSignals(maxIndividualSeverity = 0): CorrelationSignals {
  return { activeCategories: new Set<string>(), maxIndividualSeverity };
}

describe('DeterministicScorer', () => {
  it('clean session scores low risk', () => {
    const { clock } = fakeClock();
    const state = new SessionTopology('s', clock).getState();
    const score = new DeterministicScorer().score(
      { state, signals: noSignals(), timestamp: TS },
      cfg,
    );
    expect(score.session_risk_level).toBeLessThan(0.2);
    expect(score.compound_risks).toHaveLength(0);
  });

  it('escalating session scores higher and surfaces a compound risk', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(55);
    t.updateContextUtilization(0.85);
    t.updateUncommitted(900, 14);
    for (let i = 0; i < 10; i++) t.recordToolCall(i % 4 === 0 ? false : true);
    const score = new DeterministicScorer().score(
      { state: t.getState(), signals: noSignals(0.4), timestamp: TS },
      cfg,
    );
    expect(score.session_risk_level).toBeGreaterThan(0.5);
    expect(score.compound_risks.map((c) => c.id)).toContain('blind_bulldozing');
    expect(score.explanation).toMatch(/Blind Bulldozing|blind_bulldozing/);
  });

  it('ALWAYS default_priors with no calibration evidence (honesty)', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    for (let i = 0; i < 20; i++) t.recordToolCall(true);
    const score = new DeterministicScorer().score(
      { state: t.getState(), signals: noSignals(), timestamp: TS },
      cfg,
    );
    expect(score.confidence.basis).toBe('default_priors');
    expect(score.confidence.value).toBeLessThanOrEqual(0.5);
    expect(score.explanation).toMatch(/Heuristic estimate/);
  });

  it('upgrades to calibrated only with passing calibration evidence', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    for (let i = 0; i < 20; i++) t.recordToolCall(true);
    const calibrated = new DeterministicScorer().score(
      { state: t.getState(), signals: noSignals(), timestamp: TS, calibrationEvidence: CALIBRATED_SET },
      cfg,
    );
    expect(calibrated.confidence.basis).toBe('calibrated');

    const stillDefault = new DeterministicScorer().score(
      { state: t.getState(), signals: noSignals(), timestamp: TS, calibrationEvidence: MISCALIBRATED_SET },
      cfg,
    );
    expect(stillDefault.confidence.basis).toBe('default_priors');
  });

  it('risk_trend reflects recent levels', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s', clock);
    t.updateContextUtilization(0.9);
    const increasing = new DeterministicScorer().score(
      { state: t.getState(), signals: noSignals(0.6), timestamp: TS, recentLevels: [0.1, 0.2] },
      cfg,
    );
    expect(increasing.risk_trend).toBe('increasing');
  });

  it('correlation can be disabled via config', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(55);
    t.updateContextUtilization(0.85);
    t.updateUncommitted(900, 14);
    const disabled = { ...cfg, correlation: { ...cfg.correlation, enabled: false } };
    const score = new DeterministicScorer().score(
      { state: t.getState(), signals: noSignals(0.4), timestamp: TS },
      disabled,
    );
    expect(score.compound_risks).toHaveLength(0);
    expect(score.algorithms_run).not.toContain('correlation');
  });

  it('result conforms to the RiskScore shape', () => {
    const { clock } = fakeClock();
    const state = new SessionTopology('s', clock).getState();
    const score = new DeterministicScorer().score({ state, signals: noSignals(), timestamp: TS }, cfg);
    expect(score).toMatchObject({
      session_risk_level: expect.any(Number),
      risk_trend: expect.any(String),
      confidence: { value: expect.any(Number), basis: expect.any(String), sample_size: expect.any(Number) },
      algorithms_run: expect.any(Array),
      evaluation_timestamp: TS,
      explanation: expect.any(String),
    });
  });
});
