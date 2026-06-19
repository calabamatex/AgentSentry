/**
 * engine.test.ts — Phase E: RiskScoringEngine orchestration.
 */

import { describe, it, expect } from 'vitest';
import { RiskScoringEngine } from '../../src/risk-scoring/engine';
import { DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';
import type { OpsEvent } from '../../src/memory/schema';

const cfg = DEFAULT_RISK_SCORING_CONFIG;
const TS = '2026-01-01T00:00:00.000Z';

function fakeClock(start = 1_000_000) {
  let t = start;
  return { clock: () => t, advanceMinutes: (m: number) => { t += m * 60000; } };
}

function evt(partial: Partial<OpsEvent>): OpsEvent {
  return {
    id: partial.id ?? 'e',
    timestamp: partial.timestamp ?? TS,
    session_id: partial.session_id ?? 's1',
    agent_id: 'a',
    event_type: partial.event_type ?? 'decision',
    severity: partial.severity ?? 'low',
    skill: partial.skill ?? 'system',
    title: partial.title ?? 'x',
    detail: partial.detail ?? 'y',
    affected_files: partial.affected_files ?? [],
    tags: partial.tags ?? [],
    metadata: partial.metadata ?? {},
    hash: 'h',
    prev_hash: '0',
  } as OpsEvent;
}

describe('RiskScoringEngine', () => {
  it('loadFromEvents records files and tool-call outcomes', () => {
    const { clock } = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', clock);
    e.loadFromEvents([
      evt({ affected_files: ['src/a.ts'] }),
      evt({ event_type: 'violation', affected_files: ['src/b.ts'] }),
    ]);
    const state = e.getState();
    expect(Object.keys(state.files_touched)).toHaveLength(2);
    expect(state.tool_calls_count).toBe(2);
    expect(state.tool_call_errors).toBe(1); // violation counts as failure
  });

  it('detects a secret signal from tags and feeds the correlator', () => {
    const fc = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', fc.clock);
    e.loadFromEvents([evt({ affected_files: ['.env'], tags: ['secret'] })]);
    e.applySignals({ context_utilization: 0.8 });
    const score = e.evaluate(TS);
    expect(score.compound_risks.map((c) => c.id)).toContain('leak_under_pressure');
  });

  it('applySignals seeds context, uncommitted and commit age', () => {
    const fc = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', fc.clock);
    e.applySignals({ context_utilization: 0.85, uncommitted_files: 14, minutes_since_commit: 50 });
    const s = e.getState();
    expect(s.context_utilization).toBe(0.85);
    expect(s.uncommitted_file_count).toBe(14);
    expect(s.minutes_since_last_commit).toBeCloseTo(50, 0);
  });

  it('produces a Blind Bulldozing compound risk from live signals', () => {
    const fc = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', fc.clock);
    e.applySignals({ context_utilization: 0.85, uncommitted_files: 14, minutes_since_commit: 50 });
    const score = e.evaluate(TS);
    expect(score.compound_risks.map((c) => c.id)).toContain('blind_bulldozing');
    expect(score.session_risk_level).toBeGreaterThan(0.5);
  });

  it('scores are always default_priors with no calibration evidence', () => {
    const { clock } = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', clock);
    e.loadFromEvents([evt({}), evt({})]);
    expect(e.evaluate(TS).confidence.basis).toBe('default_priors');
  });

  it('populates active_profiles from misbehavior matching', () => {
    const fc = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', fc.clock);
    e.applySignals({ uncommitted_files: 14, minutes_since_commit: 60 });
    for (let i = 0; i < 12; i++) e.applyEvent(evt({ affected_files: [`src/f${i}.ts`] }));
    const score = e.evaluate(TS);
    expect(score.active_profiles.map((p) => p.profile_id)).toContain('MBP-BULLDOZER');
    expect(score.active_profiles.every((p) => p.confidence.basis === 'default_priors')).toBe(true);
  });

  it('populates active_threats from rule-based pattern detection', () => {
    const fc = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', fc.clock);
    e.applySignals({ context_utilization: 0.85, uncommitted_files: 14, minutes_since_commit: 40 });
    e.applyEvent(evt({ affected_files: ['.env'], tags: ['secret'] }));
    const score = e.evaluate(TS);
    const ids = score.active_threats.map((t) => t.pattern_id);
    expect(ids).toContain('TPL-CTX-OVERFLOW');
    expect(ids).toContain('TPL-SIZE-EXCESS');
    expect(ids).toContain('TPL-SECRET-LEAK');
    expect(score.active_threats.every((t) => t.confidence.basis === 'default_priors')).toBe(true);
    expect(score.session_risk_level).toBeGreaterThan(0.5);
  });

  it('tracks recent levels for trend across evaluations', () => {
    const fc = fakeClock();
    const e = new RiskScoringEngine(cfg, 's1', fc.clock);
    e.evaluate(TS); // low
    e.applySignals({ context_utilization: 0.9, uncommitted_files: 14, minutes_since_commit: 50 });
    const second = e.evaluate(TS);
    expect(second.risk_trend).toBe('increasing');
  });
});
