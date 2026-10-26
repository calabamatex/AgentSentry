/**
 * pattern-library.test.ts — Pattern detection → active_threats.
 */

import { describe, it, expect } from 'vitest';
import { PatternLibrary } from '../../src/risk-scoring/knowledge/pattern-library';
import { DEFAULT_RISK_PATTERNS, DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';
import { SessionTopology } from '../../src/risk-scoring/knowledge/session-topology';
import { CALIBRATED_SET, MISCALIBRATED_SET } from './fixtures/calibration-fixtures';

const cfg = DEFAULT_RISK_SCORING_CONFIG;

function fakeClock(start = 1_000_000) {
  let t = start;
  return { clock: () => t, advanceMinutes: (m: number) => { t += m * 60000; } };
}

describe('PatternLibrary', () => {
  it('ships the catalog', () => {
    expect(DEFAULT_RISK_PATTERNS.length).toBeGreaterThanOrEqual(5);
    expect(new PatternLibrary().get('TPL-CTX-OVERFLOW')).toBeDefined();
  });

  it('clean session detects no threats', () => {
    const { clock } = fakeClock();
    const state = new SessionTopology('s', clock).getState();
    expect(new PatternLibrary().detect(state, cfg).threats).toEqual([]);
  });

  it('detects context overflow above threshold', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s', clock);
    t.updateContextUtilization(0.82);
    const ids = new PatternLibrary().detect(t.getState(), cfg).threats.map((x) => x.pattern_id);
    expect(ids).toContain('TPL-CTX-OVERFLOW');
  });

  it('detects checkpoint gap only with uncommitted work', () => {
    const fc = fakeClock();
    const t = new SessionTopology('s', fc.clock);
    t.recordCommit();
    fc.advanceMinutes(40);
    // no uncommitted files yet → no gap threat
    expect(new PatternLibrary().detect(t.getState(), cfg).threats.map((x) => x.pattern_id)).not.toContain('TPL-CHKPT-GAP');
    t.updateUncommitted(50, 3);
    expect(new PatternLibrary().detect(t.getState(), cfg).threats.map((x) => x.pattern_id)).toContain('TPL-CHKPT-GAP');
  });

  it('detects oversized change set', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s', clock);
    t.updateUncommitted(900, 14);
    expect(new PatternLibrary().detect(t.getState(), cfg).threats.map((x) => x.pattern_id)).toContain('TPL-SIZE-EXCESS');
  });

  it('CONTEXT MODIFIER: a secret in a test file is downgraded vs source', () => {
    const { clock } = fakeClock();
    const lib = new PatternLibrary();

    const src = new SessionTopology('s', clock);
    src.recordRiskDetection('src/config.ts', 'secret_leak');
    const srcSev = lib.detect(src.getState(), cfg).threats.find((t) => t.pattern_id === 'TPL-SECRET-LEAK')!.severity;

    const test = new SessionTopology('s', clock);
    test.recordRiskDetection('tests/fixtures/sample.test.ts', 'secret_leak');
    const testSev = lib.detect(test.getState(), cfg).threats.find((t) => t.pattern_id === 'TPL-SECRET-LEAK')!.severity;

    expect(srcSev).toBeGreaterThan(0.8);
    expect(testSev).toBeLessThan(0.3); // 0.85 * 0.2
    expect(testSev).toBeLessThan(srcSev);
  });

  it('threats are default_priors without calibration, calibrated with passing evidence', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s', clock);
    t.updateContextUtilization(0.9);
    const lib = new PatternLibrary();
    expect(lib.detect(t.getState(), cfg).threats.every((x) => x.confidence.basis === 'default_priors')).toBe(true);
    expect(lib.detect(t.getState(), cfg, CALIBRATED_SET).threats.every((x) => x.confidence.basis === 'calibrated')).toBe(true);
    expect(lib.detect(t.getState(), cfg, MISCALIBRATED_SET).threats.every((x) => x.confidence.basis === 'default_priors')).toBe(true);
  });

  it('maxSeverity is the top context-adjusted severity', () => {
    const { clock } = fakeClock();
    const t = new SessionTopology('s', clock);
    t.recordRiskDetection('src/a.ts', 'secret_leak'); // 0.85
    t.updateContextUtilization(0.9); // 0.6
    const det = new PatternLibrary().detect(t.getState(), cfg);
    expect(det.maxSeverity).toBeCloseTo(0.85, 5);
  });
});
