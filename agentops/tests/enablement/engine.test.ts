import { describe, it, expect } from 'vitest';
import {
  generateConfigForLevel,
  isSkillEnabled,
  getActiveSkills,
  getNextLevel,
  validateEnablementConfig,
  LEVEL_NAMES,
  ALL_SKILLS,
  type EnablementConfig,
} from '../../src/enablement/engine';

// ---------------------------------------------------------------------------
// generateConfigForLevel
// ---------------------------------------------------------------------------

describe('generateConfigForLevel', () => {
  it('level 1: only save_points enabled (full)', () => {
    const cfg = generateConfigForLevel(1);
    expect(cfg.level).toBe(1);
    expect(cfg.skills.save_points).toEqual({ enabled: true, mode: 'full' });
    expect(cfg.skills.context_health).toEqual({ enabled: false, mode: 'off' });
    expect(cfg.skills.standing_orders).toEqual({ enabled: false, mode: 'off' });
    expect(cfg.skills.small_bets).toEqual({ enabled: false, mode: 'off' });
    expect(cfg.skills.proactive_safety).toEqual({ enabled: false, mode: 'off' });
  });

  it('level 2: save_points + context_health (full)', () => {
    const cfg = generateConfigForLevel(2);
    expect(cfg.level).toBe(2);
    expect(cfg.skills.save_points).toEqual({ enabled: true, mode: 'full' });
    expect(cfg.skills.context_health).toEqual({ enabled: true, mode: 'full' });
    expect(cfg.skills.standing_orders).toEqual({ enabled: false, mode: 'off' });
    expect(cfg.skills.small_bets).toEqual({ enabled: false, mode: 'off' });
    expect(cfg.skills.proactive_safety).toEqual({ enabled: false, mode: 'off' });
  });

  it('level 3: + standing_orders (basic)', () => {
    const cfg = generateConfigForLevel(3);
    expect(cfg.skills.save_points).toEqual({ enabled: true, mode: 'full' });
    expect(cfg.skills.context_health).toEqual({ enabled: true, mode: 'full' });
    expect(cfg.skills.standing_orders).toEqual({ enabled: true, mode: 'basic' });
    expect(cfg.skills.small_bets).toEqual({ enabled: false, mode: 'off' });
    expect(cfg.skills.proactive_safety).toEqual({ enabled: false, mode: 'off' });
  });

  it('level 4: + small_bets (basic), standing_orders upgrades to full', () => {
    const cfg = generateConfigForLevel(4);
    expect(cfg.skills.standing_orders).toEqual({ enabled: true, mode: 'full' });
    expect(cfg.skills.small_bets).toEqual({ enabled: true, mode: 'basic' });
    expect(cfg.skills.proactive_safety).toEqual({ enabled: false, mode: 'off' });
  });

  it('level 5: all skills full', () => {
    const cfg = generateConfigForLevel(5);
    expect(cfg.level).toBe(5);
    for (const skill of ALL_SKILLS) {
      expect(cfg.skills[skill]).toEqual({ enabled: true, mode: 'full' });
    }
  });

  it('throws on invalid level', () => {
    expect(() => generateConfigForLevel(0)).toThrow(RangeError);
    expect(() => generateConfigForLevel(6)).toThrow(RangeError);
    expect(() => generateConfigForLevel(2.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// isSkillEnabled
// ---------------------------------------------------------------------------

describe('isSkillEnabled', () => {
  it('returns true for enabled skills', () => {
    const cfg = generateConfigForLevel(2);
    expect(isSkillEnabled(cfg, 'save_points')).toBe(true);
    expect(isSkillEnabled(cfg, 'context_health')).toBe(true);
  });

  it('returns false for disabled skills', () => {
    const cfg = generateConfigForLevel(1);
    expect(isSkillEnabled(cfg, 'context_health')).toBe(false);
    expect(isSkillEnabled(cfg, 'proactive_safety')).toBe(false);
  });

  it('returns false for unknown skill names', () => {
    const cfg = generateConfigForLevel(5);
    expect(isSkillEnabled(cfg, 'nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getActiveSkills
// ---------------------------------------------------------------------------

describe('getActiveSkills', () => {
  it('level 1: one active skill', () => {
    expect(getActiveSkills(generateConfigForLevel(1))).toEqual(['save_points']);
  });

  it('level 3: three active skills', () => {
    expect(getActiveSkills(generateConfigForLevel(3))).toEqual([
      'save_points',
      'context_health',
      'standing_orders',
    ]);
  });

  it('level 5: all five active', () => {
    expect(getActiveSkills(generateConfigForLevel(5))).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// getNextLevel
// ---------------------------------------------------------------------------

describe('getNextLevel', () => {
  it('returns next level info from level 1', () => {
    const cfg = generateConfigForLevel(1);
    const next = getNextLevel(cfg);
    expect(next).not.toBeNull();
    expect(next!.level).toBe(2);
    expect(next!.name).toBe('Clear Head');
    expect(next!.unlocks).toContain('context_health');
  });

  it('returns upgrade info from level 3', () => {
    const next = getNextLevel(generateConfigForLevel(3));
    expect(next).not.toBeNull();
    expect(next!.level).toBe(4);
    expect(next!.unlocks).toContain('small_bets');
    // standing_orders upgrades from basic to full
    expect(next!.unlocks.some((u) => u.includes('standing_orders') && u.includes('full'))).toBe(
      true,
    );
  });

  it('returns null at level 5', () => {
    expect(getNextLevel(generateConfigForLevel(5))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LEVEL_NAMES
// ---------------------------------------------------------------------------

describe('LEVEL_NAMES', () => {
  it('has names for all 5 levels', () => {
    for (let i = 1; i <= 5; i++) {
      expect(LEVEL_NAMES[i]).toBeDefined();
      expect(typeof LEVEL_NAMES[i]).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// validateEnablementConfig
// ---------------------------------------------------------------------------

describe('validateEnablementConfig', () => {
  it('accepts valid configs from every level', () => {
    for (let i = 1; i <= 5; i++) {
      const result = validateEnablementConfig(generateConfigForLevel(i));
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
  });

  it('rejects null', () => {
    const result = validateEnablementConfig(null);
    expect(result.valid).toBe(false);
  });

  it('rejects missing level', () => {
    const result = validateEnablementConfig({ skills: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('level'))).toBe(true);
  });

  it('rejects level out of range', () => {
    const cfg = generateConfigForLevel(1);
    (cfg as any).level = 10;
    const result = validateEnablementConfig(cfg);
    expect(result.valid).toBe(false);
  });

  it('rejects missing skills', () => {
    const result = validateEnablementConfig({ level: 1 });
    expect(result.valid).toBe(false);
  });

  it('rejects missing required skill', () => {
    const cfg = generateConfigForLevel(1);
    delete (cfg.skills as any).proactive_safety;
    const result = validateEnablementConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('proactive_safety'))).toBe(true);
  });

  it('rejects invalid mode', () => {
    const cfg = generateConfigForLevel(1);
    (cfg.skills.save_points as any).mode = 'turbo';
    const result = validateEnablementConfig(cfg);
    expect(result.valid).toBe(false);
  });

  it('rejects enabled:true with mode:off', () => {
    const cfg = generateConfigForLevel(1);
    cfg.skills.save_points = { enabled: true, mode: 'off' };
    const result = validateEnablementConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("enabled but mode is 'off'"))).toBe(true);
  });

  it('rejects enabled:false with mode:full', () => {
    const cfg = generateConfigForLevel(1);
    cfg.skills.context_health = { enabled: false, mode: 'full' };
    const result = validateEnablementConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("disabled but mode is not 'off'"))).toBe(true);
  });

  it('rejects non-boolean enabled', () => {
    const cfg = generateConfigForLevel(1);
    (cfg.skills.save_points as any).enabled = 'yes';
    const result = validateEnablementConfig(cfg);
    expect(result.valid).toBe(false);
  });
});
