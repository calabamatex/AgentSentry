/**
 * Enablement module — public API surface.
 *
 * Re-exports all types and functions from the enablement engine and
 * the dashboard adapter so consumers can import from a single path.
 */

export {
  type SkillConfig,
  type EnablementConfig,
  type SkillName,
  LEVEL_NAMES,
  ALL_SKILLS,
  generateConfigForLevel,
  isSkillEnabled,
  getActiveSkills,
  getNextLevel,
  validateEnablementConfig,
} from './engine';

export {
  type DashboardPanel,
  getDashboardPanels,
  getDashboardHeader,
} from './dashboard-adapter';
