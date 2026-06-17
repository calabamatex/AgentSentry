/**
 * correlator.test.ts — Phase C: compound-risk correlation.
 */

import { describe, it, expect } from 'vitest';
import { RiskCorrelator, type CorrelationSignals } from '../../src/risk-scoring/correlation/correlator';
import { SessionTopology } from '../../src/risk-scoring/knowledge/session-topology';

function fakeClock(start = 1_000_000) {
  let t = start;
  return { clock: () => t, advanceMinutes: (m: number) => { t += m * 60000; } };
}

function noSignals(maxIndividualSeverity = 0): CorrelationSignals {
  return { activeCategories: new Set<string>(), maxIndividualSeverity };
}

describe('RiskCorrelator', () => {
  it('clean state produces no compound risks', () => {
    const { clock } = fakeClock();
    const state = new SessionTopology('s', clock).getState();
    expect(new RiskCorrelator().evaluate(state, noSignals())).toEqual([]);
  });

  it('Blind Bulldozing fires on high context + big diff + stale commit', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(52);
    t.updateContextUtilization(0.82);
    t.updateUncommitted(800, 14);
    const risks = new RiskCorrelator().evaluate(t.getState(), noSignals(0.4));
    const bb = risks.find((r) => r.id === 'blind_bulldozing')!;
    expect(bb).toBeDefined();
    expect(bb.compound_severity).toBeCloseTo(0.65, 5); // 0.4 + 0.25
    expect(bb.exceeds_individual_max_by).toBeCloseTo(0.25, 5);
    expect(bb.individual_signals.length).toBe(3);
  });

  it('Blind Bulldozing does NOT fire on partial conditions', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(52);
    t.updateContextUtilization(0.82);
    t.updateUncommitted(800, 4); // only 4 files — below 10
    const risks = new RiskCorrelator().evaluate(t.getState(), noSignals(0.4));
    expect(risks.find((r) => r.id === 'blind_bulldozing')).toBeUndefined();
  });

  it('Leak Under Pressure needs both a secret category and high context', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.updateContextUtilization(0.8);
    const withSecret: CorrelationSignals = { activeCategories: new Set(['secret_leak']), maxIndividualSeverity: 0.85 };
    const risks = new RiskCorrelator().evaluate(t.getState(), withSecret);
    expect(risks.find((r) => r.id === 'leak_under_pressure')).toBeDefined();

    const noSecret = new RiskCorrelator().evaluate(t.getState(), noSignals(0.85));
    expect(noSecret.find((r) => r.id === 'leak_under_pressure')).toBeUndefined();
  });

  it('Scope Explosion fires across 3+ directories with a growing diff', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s', clock);
    t.recordFileTouch('src/a/x.ts', true);
    t.recordFileTouch('src/b/y.ts', true);
    t.recordFileTouch('src/c/z.ts', true);
    t.updateUncommitted(200, 6);
    const risks = new RiskCorrelator().evaluate(t.getState(), noSignals(0.3));
    expect(risks.find((r) => r.id === 'scope_explosion')).toBeDefined();
  });

  it('multiple compound risks can fire simultaneously', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(60);
    t.updateContextUtilization(0.9);
    t.recordFileTouch('src/a/x.ts', true);
    t.recordFileTouch('src/b/y.ts', true);
    t.recordFileTouch('src/c/z.ts', true);
    t.updateUncommitted(900, 12);
    const ids = new RiskCorrelator().evaluate(t.getState(), noSignals(0.5)).map((r) => r.id);
    expect(ids).toContain('blind_bulldozing');
    expect(ids).toContain('scope_explosion');
  });

  it('compound severity is clamped to 1.0', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(60);
    t.updateContextUtilization(0.9);
    t.updateUncommitted(900, 12);
    const r = new RiskCorrelator().evaluate(t.getState(), noSignals(0.95));
    const bb = r.find((x) => x.id === 'blind_bulldozing')!;
    expect(bb.compound_severity).toBe(1); // 0.95 + 0.25 clamped
  });
});
