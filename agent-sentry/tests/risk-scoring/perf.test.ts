/**
 * perf.test.ts — Phase G: risk scoring stays within its evaluation budget.
 *
 * Robust by design: we assert on the engine's OWN reported compute time
 * (performance.now around the scorer) against the configured budget, not on
 * wall-clock test timing — so it does not flake under CI load.
 */

import { describe, it, expect } from 'vitest';
import { RiskScoringEngine, DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';
import type { OpsEvent } from '../../src/memory/schema';

const cfg = DEFAULT_RISK_SCORING_CONFIG;
const TS = '2026-01-01T00:00:00.000Z';

function evt(i: number): OpsEvent {
  return {
    id: `e${i}`,
    timestamp: TS,
    session_id: 's1',
    agent_id: 'a',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 't',
    detail: 'd',
    affected_files: [`src/f${i % 7}.ts`],
    tags: [],
    metadata: {},
    hash: 'h',
    prev_hash: '0',
  } as OpsEvent;
}

describe('risk scoring performance budget', () => {
  it('a quick evaluation stays well within the configured budget', () => {
    const engine = new RiskScoringEngine(cfg, 's1', () => 1_000_000);
    for (let i = 0; i < 200; i++) engine.applyEvent(evt(i));
    engine.applySignals({ context_utilization: 0.8, uncommitted_files: 12, minutes_since_commit: 50 });

    const budget = cfg.performance.max_evaluation_time_ms; // 100ms
    for (let run = 0; run < 100; run++) {
      const score = engine.evaluate(TS);
      expect(score.total_execution_time_ms).toBeLessThan(budget);
    }
  });

  it('loading a large event history does not throw and remains scoreable', () => {
    const engine = new RiskScoringEngine(cfg, 's1', () => 1_000_000);
    const events = Array.from({ length: 1000 }, (_, i) => evt(i));
    engine.loadFromEvents(events);
    const score = engine.evaluate(TS);
    expect(score.session_risk_level).toBeGreaterThanOrEqual(0);
    expect(score.confidence.basis).toBe('default_priors');
  });
});
