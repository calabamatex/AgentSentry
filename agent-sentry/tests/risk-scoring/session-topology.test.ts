/**
 * session-topology.test.ts — Phase C: in-memory session state.
 *
 * Uses a controllable clock — no wall-clock dependence, fully deterministic.
 */

import { describe, it, expect } from 'vitest';
import { SessionTopology } from '../../src/risk-scoring/knowledge/session-topology';

/** Mutable fake clock in epoch ms. */
function fakeClock(start = 1_000_000) {
  let t = start;
  const clock = () => t;
  return { clock, advanceMinutes: (m: number) => { t += m * 60000; }, set: (v: number) => { t = v; } };
}

describe('SessionTopology', () => {
  it('fresh topology has zero state', () => {
    const { clock } = fakeClock();
    const s = new SessionTopology('s1', clock).getState();
    expect(s.session_id).toBe('s1');
    expect(s.tool_calls_count).toBe(0);
    expect(s.error_rate).toBe(0);
    expect(Object.keys(s.files_touched)).toHaveLength(0);
    expect(s.minutes_since_last_commit).toBe(Infinity);
  });

  it('recordFileTouch adds a file and increments edit_count on repeat', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.recordFileTouch('src/a.ts', true);
    t.recordFileTouch('src/a.ts', true);
    const f = t.getState().files_touched['src/a.ts'];
    expect(f.edit_count).toBe(2);
    expect(f.in_declared_scope).toBe(true);
  });

  it('in_declared_scope tightens to false once observed out of scope', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.recordFileTouch('src/a.ts', true);
    t.recordFileTouch('src/a.ts', false);
    expect(t.getState().files_touched['src/a.ts'].in_declared_scope).toBe(false);
  });

  it('recordToolCall tracks counts and error rate', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.recordToolCall(true);
    t.recordToolCall(false);
    t.recordToolCall(false);
    const s = t.getState();
    expect(s.tool_calls_count).toBe(3);
    expect(s.tool_call_errors).toBe(2);
    expect(s.error_rate).toBeCloseTo(2 / 3, 5);
  });

  it('getMinutesSinceLastCommit uses the injected clock', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s1', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(45);
    expect(t.getState().minutes_since_last_commit).toBeCloseTo(45, 5);
  });

  it('session duration advances with the clock', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s1', fc.clock);
    fc.advanceMinutes(90);
    expect(t.getState().session_duration_minutes).toBeCloseTo(90, 5);
  });

  it('getUniqueDirectories extracts directories', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.recordFileTouch('src/auth/login.ts', true);
    t.recordFileTouch('src/auth/logout.ts', true);
    t.recordFileTouch('src/db/conn.ts', true);
    t.recordFileTouch('README.md', true);
    expect(t.getState().unique_directories).toEqual(['.', 'src/auth', 'src/db']);
  });

  it('recordRiskDetection tags a file and surfaces in active risks', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.recordFileTouch('src/a.ts', true);
    t.recordRiskDetection('src/a.ts', 'TPL-SECRET-APIKEY');
    t.recordRiskDetection('src/a.ts', 'TPL-SECRET-APIKEY'); // dedup
    const risky = t.getFilesWithActiveRisks();
    expect(risky).toHaveLength(1);
    expect(risky[0].active_risks).toEqual(['TPL-SECRET-APIKEY']);
  });

  it('recordCommit resets uncommitted counters', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.updateUncommitted(500, 12);
    expect(t.getState().uncommitted_file_count).toBe(12);
    t.recordCommit();
    expect(t.getState().uncommitted_file_count).toBe(0);
    expect(t.getState().uncommitted_diff_size).toBe(0);
  });

  it('module_has_incident_history reflects overlap with touched dirs', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.recordFileTouch('src/auth/login.ts', true);
    expect(t.getState().module_has_incident_history).toBe(false);
    t.loadModuleHistory(
      new Map([['src/auth', [{ session_id: 'old', event_type: 'incident', severity: 'high', title: 'x', timestamp: 't' }]]]),
    );
    expect(t.getState().module_has_incident_history).toBe(true);
  });

  it('context utilization is clamped to [0,1]', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.updateContextUtilization(1.5);
    expect(t.getState().context_utilization).toBe(1);
    t.updateContextUtilization(-0.2);
    expect(t.getState().context_utilization).toBe(0);
  });

  it('getState returns an isolated snapshot (no shared mutation)', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s1', clock);
    t.recordFileTouch('src/a.ts', true);
    const snap = t.getState();
    snap.files_touched['src/a.ts'].edit_count = 999;
    expect(t.getState().files_touched['src/a.ts'].edit_count).toBe(1);
  });
});
