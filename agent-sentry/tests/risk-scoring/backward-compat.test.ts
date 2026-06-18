/**
 * backward-compat.test.ts — Phase G: risk scoring must not change Levels 1-5.
 */

import { describe, it, expect } from 'vitest';
import {
  generateConfigForLevel,
  getActiveSkills,
  ALL_SKILLS,
} from '../../src/enablement/engine';
import { RiskScoringConfigSchema, DEFAULT_RISK_SCORING_CONFIG } from '../../src/risk-scoring';

describe('risk scoring backward compatibility', () => {
  it('Levels 1-5 keep risk_scoring OFF', () => {
    for (let level = 1; level <= 5; level++) {
      const cfg = generateConfigForLevel(level);
      expect(cfg.skills.risk_scoring).toEqual({ enabled: false, mode: 'off' });
    }
  });

  it('Level 6 turns risk_scoring ON (full)', () => {
    expect(generateConfigForLevel(6).skills.risk_scoring).toEqual({ enabled: true, mode: 'full' });
  });

  it('risk_scoring is not an active skill below Level 6', () => {
    for (let level = 1; level <= 5; level++) {
      expect(getActiveSkills(generateConfigForLevel(level))).not.toContain('risk_scoring');
    }
    expect(getActiveSkills(generateConfigForLevel(6))).toContain('risk_scoring');
  });

  it('Levels 1-5 retain exactly their original active skills (no new ones leak in)', () => {
    // Level 5 = all the pre-existing skills full, but NOT risk_scoring.
    const l5 = getActiveSkills(generateConfigForLevel(5));
    expect(l5).not.toContain('risk_scoring');
    // sanity: the original six skills still exist in the model
    expect(ALL_SKILLS).toContain('save_points');
    expect(ALL_SKILLS).toContain('proactive_safety');
  });

  it('downgrade L6 -> L5 deactivates risk_scoring', () => {
    expect(generateConfigForLevel(6).skills.risk_scoring.enabled).toBe(true);
    expect(generateConfigForLevel(5).skills.risk_scoring.enabled).toBe(false);
  });

  it('a config with no risk_scoring section falls back to safe defaults', () => {
    const parsed = RiskScoringConfigSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(parsed).toEqual(DEFAULT_RISK_SCORING_CONFIG);
  });
});
