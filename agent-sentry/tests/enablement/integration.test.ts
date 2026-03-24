import { describe, it, expect } from 'vitest';
import {
  generateConfigForLevel,
  validateEnablementConfig,
  getActiveSkills,
  getNextLevel,
  LEVEL_NAMES,
} from '../../src/enablement/engine';
import { getDashboardPanels, getDashboardHeader } from '../../src/enablement/dashboard-adapter';

// ---------------------------------------------------------------------------
// Full pipeline: generate -> validate -> dashboard
// ---------------------------------------------------------------------------

describe('integration: config generation -> validation -> dashboard', () => {
  for (let level = 1; level <= 5; level++) {
    it(`level ${level} (${LEVEL_NAMES[level]}): end-to-end flow`, () => {
      // Step 1: Generate config
      const config = generateConfigForLevel(level);
      expect(config.level).toBe(level);

      // Step 2: Validate the generated config
      const validation = validateEnablementConfig(config);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Step 3: Derive dashboard panels
      const panels = getDashboardPanels(config);
      expect(panels).toHaveLength(5);

      // Step 4: Derive dashboard header
      const header = getDashboardHeader(config);
      expect(header.level).toBe(level);
      expect(header.name).toBe(LEVEL_NAMES[level]);

      // Step 5: Active skills count matches header
      const active = getActiveSkills(config);
      expect(active.length).toBe(header.activeCount);

      // Step 6: Enabled panels match active skills
      const enabledPanels = panels.filter((p) => p.enabled);
      expect(enabledPanels).toHaveLength(active.length);
      for (const panel of enabledPanels) {
        expect(active).toContain(panel.skill);
        expect(panel.upgradeMessage).toBeUndefined();
      }

      // Step 7: Disabled panels all have upgrade messages
      const disabledPanels = panels.filter((p) => !p.enabled);
      for (const panel of disabledPanels) {
        expect(panel.upgradeMessage).toBeDefined();
        expect(panel.upgradeMessage).toMatch(/^Enable Level \d to unlock$/);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Level progression
// ---------------------------------------------------------------------------

describe('integration: level progression chain', () => {
  it('walks from level 1 to 5 via getNextLevel', () => {
    let currentLevel = 1;
    const visited = [currentLevel];

    while (currentLevel < 5) {
      const config = generateConfigForLevel(currentLevel);
      const next = getNextLevel(config);
      expect(next).not.toBeNull();
      expect(next!.level).toBe(currentLevel + 1);
      expect(next!.name).toBe(LEVEL_NAMES[currentLevel + 1]);
      expect(next!.unlocks.length).toBeGreaterThan(0);

      currentLevel = next!.level;
      visited.push(currentLevel);
    }

    expect(visited).toEqual([1, 2, 3, 4, 5]);

    // At level 5, no next level
    expect(getNextLevel(generateConfigForLevel(5))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Round-trip serialization
// ---------------------------------------------------------------------------

describe('integration: JSON round-trip', () => {
  it('config survives JSON serialization and re-validation', () => {
    for (let level = 1; level <= 5; level++) {
      const original = generateConfigForLevel(level);
      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized);

      const result = validateEnablementConfig(deserialized);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Deep equality
      expect(deserialized).toEqual(original);
    }
  });
});

// ---------------------------------------------------------------------------
// Skill monotonicity
// ---------------------------------------------------------------------------

describe('integration: skill monotonicity across levels', () => {
  it('skills only add or upgrade, never remove when going up levels', () => {
    for (let level = 1; level < 5; level++) {
      const current = generateConfigForLevel(level);
      const next = generateConfigForLevel(level + 1);

      const currentActive = getActiveSkills(current);
      const nextActive = getActiveSkills(next);

      // Every currently active skill remains active at the next level
      for (const skill of currentActive) {
        expect(nextActive).toContain(skill);
      }

      // Next level has at least as many active skills
      expect(nextActive.length).toBeGreaterThanOrEqual(currentActive.length);
    }
  });
});
