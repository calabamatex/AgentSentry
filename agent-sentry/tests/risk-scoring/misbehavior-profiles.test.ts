/**
 * misbehavior-profiles.test.ts — Phase D: behavioral failure-mode matching.
 */

import { describe, it, expect } from 'vitest';
import { MisbehaviorProfileStore } from '../../src/risk-scoring/knowledge/misbehavior-profiles';
import { DEFAULT_MISBEHAVIOR_PROFILES, DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';
import { SessionTopology } from '../../src/risk-scoring/knowledge/session-topology';
import { CALIBRATED_SET, MISCALIBRATED_SET } from './fixtures/calibration-fixtures';

const cfg = DEFAULT_RISK_SCORING_CONFIG;

function fakeClock(start = 1_000_000) {
  let t = start;
  return { clock: () => t, advanceMinutes: (m: number) => { t += m * 60000; } };
}

describe('MisbehaviorProfileStore', () => {
  it('ships five profiles', () => {
    expect(DEFAULT_MISBEHAVIOR_PROFILES).toHaveLength(5);
    expect(new MisbehaviorProfileStore().getAll().map((p) => p.id)).toContain('MBP-BULLDOZER');
  });

  it('a clean session elevates no profile', () => {
    const { clock } = fakeClock();
    const state = new SessionTopology('s', clock).getState();
    expect(new MisbehaviorProfileStore().evaluate(state, cfg)).toEqual([]);
  });

  it('elevates The Bulldozer on a stale commit + many files', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(50);
    t.updateUncommitted(900, 12);
    for (let i = 0; i < 12; i++) t.recordFileTouch(`src/f${i}.ts`, true);
    const active = new MisbehaviorProfileStore().evaluate(t.getState(), cfg);
    const bulldozer = active.find((p) => p.profile_id === 'MBP-BULLDOZER');
    expect(bulldozer).toBeDefined();
    expect(bulldozer!.matched_preconditions.length).toBeGreaterThan(0);
    expect(bulldozer!.recommended_action).toMatch(/checkpoint|commit/i);
  });

  it('elevates The Loop Runner on repeated errors', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    fc.advanceMinutes(35);
    for (let i = 0; i < 6; i++) t.recordToolCall(false);
    const active = new MisbehaviorProfileStore().evaluate(t.getState(), cfg);
    expect(active.find((p) => p.profile_id === 'MBP-LOOP-RUNNER')).toBeDefined();
  });

  it('profile likelihoods are default_priors with no calibration evidence', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(50);
    for (let i = 0; i < 12; i++) t.recordFileTouch(`src/f${i}.ts`, true);
    const active = new MisbehaviorProfileStore().evaluate(t.getState(), cfg);
    expect(active.length).toBeGreaterThan(0);
    for (const p of active) {
      expect(p.confidence.basis).toBe('default_priors');
      expect(p.confidence.value).toBeLessThanOrEqual(0.5);
    }
  });

  it('upgrades confidence to calibrated only with passing evidence', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(50);
    for (let i = 0; i < 12; i++) t.recordFileTouch(`src/f${i}.ts`, true);
    const state = t.getState();

    const calibrated = new MisbehaviorProfileStore().evaluate(state, cfg, CALIBRATED_SET);
    expect(calibrated.every((p) => p.confidence.basis === 'calibrated')).toBe(true);

    const stillDefault = new MisbehaviorProfileStore().evaluate(state, cfg, MISCALIBRATED_SET);
    expect(stillDefault.every((p) => p.confidence.basis === 'default_priors')).toBe(true);
  });

  it('returns profiles sorted most-likely first', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(70);
    t.updateContextUtilization(0.9);
    for (let i = 0; i < 12; i++) t.recordFileTouch(`src/f${i}.ts`, true);
    for (let i = 0; i < 5; i++) t.recordToolCall(false);
    const active = new MisbehaviorProfileStore().evaluate(t.getState(), cfg);
    for (let i = 1; i < active.length; i++) {
      expect(active[i - 1].likelihood).toBeGreaterThanOrEqual(active[i].likelihood);
    }
  });
});
