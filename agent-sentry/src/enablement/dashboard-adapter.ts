/**
 * Dashboard Adapter — translates EnablementConfig into dashboard-ready data.
 *
 * The dashboard uses these structures to decide which panels to render and
 * what upgrade prompts to show.
 */

import {
  type EnablementConfig,
  type SkillConfig,
  ALL_SKILLS,
  LEVEL_NAMES,
  getActiveSkills,
} from './engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardPanel {
  skill: string;
  enabled: boolean;
  mode: string;
  title: string;
  upgradeMessage?: string;
}

export interface DashboardHeader {
  level: number;
  name: string;
  activeCount: number;
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Skill display metadata
// ---------------------------------------------------------------------------

const SKILL_TITLES: Record<string, string> = {
  save_points: 'Save Points',
  context_health: 'Context Health',
  standing_orders: 'Standing Orders',
  directive_compliance: 'Hook Safety',
  small_bets: 'Small Bets',
  proactive_safety: 'Proactive Safety',
};

/**
 * Maps each skill to the minimum level required to enable it.
 */
const SKILL_UNLOCK_LEVEL: Record<string, number> = {
  save_points: 1,
  context_health: 2,
  standing_orders: 3,
  directive_compliance: 3,
  small_bets: 4,
  proactive_safety: 5,
};

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Generate dashboard panel descriptors for every skill.
 *
 * Enabled skills get their current mode displayed. Disabled skills receive
 * an `upgradeMessage` telling the user which level unlocks them.
 */
export function getDashboardPanels(config: EnablementConfig): DashboardPanel[] {
  const skills = config.skills as Record<string, SkillConfig>;

  return ALL_SKILLS.map((skill) => {
    const entry = skills[skill];
    const title = SKILL_TITLES[skill] ?? skill;

    if (entry && entry.enabled) {
      return {
        skill,
        enabled: true,
        mode: entry.mode,
        title,
      };
    }

    const unlockLevel = SKILL_UNLOCK_LEVEL[skill] ?? 5;
    return {
      skill,
      enabled: false,
      mode: 'off',
      title,
      upgradeMessage: `Enable Level ${unlockLevel} to unlock`,
    };
  });
}

/**
 * Generate a summary header for the dashboard.
 */
export function getDashboardHeader(config: EnablementConfig): DashboardHeader {
  const active = getActiveSkills(config);
  return {
    level: config.level,
    name: LEVEL_NAMES[config.level] ?? `Level ${config.level}`,
    activeCount: active.length,
    totalCount: ALL_SKILLS.length,
  };
}
