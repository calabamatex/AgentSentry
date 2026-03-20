/**
 * Enablement Engine — Progressive skill enablement for AgentOps v4.0
 *
 * Controls which AgentOps skills are active based on the user's chosen
 * enablement level. Levels unlock skills incrementally so that non-experts
 * can adopt AgentOps without being overwhelmed.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillConfig {
  enabled: boolean;
  mode: 'off' | 'basic' | 'full';
}

export interface EnablementConfig {
  level: number;
  skills: {
    save_points: SkillConfig;
    context_health: SkillConfig;
    standing_orders: SkillConfig;
    small_bets: SkillConfig;
    proactive_safety: SkillConfig;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEVEL_NAMES: Record<number, string> = {
  1: 'Safe Ground',
  2: 'Clear Head',
  3: 'House Rules',
  4: 'Right Size',
  5: 'Full Guard',
};

export const ALL_SKILLS = [
  'save_points',
  'context_health',
  'standing_orders',
  'small_bets',
  'proactive_safety',
] as const;

export type SkillName = (typeof ALL_SKILLS)[number];

const VALID_MODES = new Set(['off', 'basic', 'full']);

// ---------------------------------------------------------------------------
// Level generation
// ---------------------------------------------------------------------------

function off(): SkillConfig {
  return { enabled: false, mode: 'off' };
}

function basic(): SkillConfig {
  return { enabled: true, mode: 'basic' };
}

function full(): SkillConfig {
  return { enabled: true, mode: 'full' };
}

/**
 * Generate the canonical enablement config for a given level.
 *
 * Level 1: only save_points enabled (full mode)
 * Level 2: + context_health (full)
 * Level 3: + standing_orders (basic)
 * Level 4: + small_bets (basic), standing_orders upgrades to full
 * Level 5: + proactive_safety (full), small_bets upgrades to full
 */
export function generateConfigForLevel(level: number): EnablementConfig {
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    throw new RangeError(`Enablement level must be an integer between 1 and 5, got ${level}`);
  }

  const config: EnablementConfig = {
    level,
    skills: {
      save_points: off(),
      context_health: off(),
      standing_orders: off(),
      small_bets: off(),
      proactive_safety: off(),
    },
  };

  // Level 1+
  if (level >= 1) {
    config.skills.save_points = full();
  }

  // Level 2+
  if (level >= 2) {
    config.skills.context_health = full();
  }

  // Level 3+
  if (level >= 3) {
    config.skills.standing_orders = basic();
  }

  // Level 4+
  if (level >= 4) {
    config.skills.standing_orders = full();
    config.skills.small_bets = basic();
  }

  // Level 5
  if (level >= 5) {
    config.skills.small_bets = full();
    config.skills.proactive_safety = full();
  }

  return config;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a specific skill is enabled in the given config.
 */
export function isSkillEnabled(config: EnablementConfig, skill: string): boolean {
  const skills = config.skills as Record<string, SkillConfig>;
  const entry = skills[skill];
  if (!entry) {
    return false;
  }
  return entry.enabled === true;
}

/**
 * Return the list of currently active skill names.
 */
export function getActiveSkills(config: EnablementConfig): string[] {
  return ALL_SKILLS.filter((skill) => isSkillEnabled(config, skill));
}

/**
 * Return info about the next level, or null if already at max.
 */
export function getNextLevel(
  config: EnablementConfig,
): { level: number; name: string; unlocks: string[] } | null {
  if (config.level >= 5) {
    return null;
  }

  const next = config.level + 1;
  const currentActive = new Set(getActiveSkills(config));
  const nextConfig = generateConfigForLevel(next);

  const unlocks: string[] = [];
  for (const skill of ALL_SKILLS) {
    const nextSkill = nextConfig.skills[skill];
    const curSkill = (config.skills as Record<string, SkillConfig>)[skill];

    if (!curSkill) {
      if (nextSkill.enabled) {
        unlocks.push(skill);
      }
      continue;
    }

    // Newly enabled or upgraded mode
    if (!curSkill.enabled && nextSkill.enabled) {
      unlocks.push(skill);
    } else if (curSkill.enabled && nextSkill.enabled && curSkill.mode !== nextSkill.mode) {
      unlocks.push(`${skill} (upgrade to ${nextSkill.mode})`);
    }
  }

  return {
    level: next,
    name: LEVEL_NAMES[next],
    unlocks,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value as a valid EnablementConfig.
 * Returns { valid: true, errors: [] } on success,
 * or { valid: false, errors: [...] } on failure.
 */
export function validateEnablementConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config === null || config === undefined || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be a non-null object'] };
  }

  const obj = config as Record<string, unknown>;

  // --- level ---
  if (!('level' in obj)) {
    errors.push('Missing required property: level');
  } else if (typeof obj.level !== 'number' || !Number.isInteger(obj.level)) {
    errors.push('level must be an integer');
  } else if (obj.level < 1 || obj.level > 5) {
    errors.push('level must be between 1 and 5');
  }

  // --- skills ---
  if (!('skills' in obj)) {
    errors.push('Missing required property: skills');
  } else if (typeof obj.skills !== 'object' || obj.skills === null) {
    errors.push('skills must be a non-null object');
  } else {
    const skills = obj.skills as Record<string, unknown>;

    for (const skillName of ALL_SKILLS) {
      if (!(skillName in skills)) {
        errors.push(`Missing required skill: ${skillName}`);
        continue;
      }

      const skill = skills[skillName];
      if (typeof skill !== 'object' || skill === null) {
        errors.push(`${skillName} must be a non-null object`);
        continue;
      }

      const s = skill as Record<string, unknown>;

      if (typeof s.enabled !== 'boolean') {
        errors.push(`${skillName}.enabled must be a boolean`);
      }

      if (typeof s.mode !== 'string' || !VALID_MODES.has(s.mode)) {
        errors.push(`${skillName}.mode must be one of: off, basic, full`);
      }

      // Cross-check: if enabled is false, mode should be 'off'
      if (s.enabled === false && s.mode !== 'off') {
        errors.push(`${skillName} is disabled but mode is not 'off'`);
      }

      // Cross-check: if enabled is true, mode should not be 'off'
      if (s.enabled === true && s.mode === 'off') {
        errors.push(`${skillName} is enabled but mode is 'off'`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
