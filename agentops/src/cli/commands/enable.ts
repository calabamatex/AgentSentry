/**
 * enable.ts — CLI command: progressive enablement onboarding.
 *
 * `npx agent-sentry enable --level N` activates the specified enablement level,
 * prints what skills it enables, and stores the level change in MemoryStore.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CommandDefinition, ParsedArgs, output, isJson } from '../parser';
import { resolveConfigPath } from '../../config/resolve';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'cli-enable' });
import {
  generateConfigForLevel,
  getActiveSkills,
  getNextLevel,
  LEVEL_NAMES,
  ALL_SKILLS,
} from '../../enablement/engine';

const DEFAULT_CONFIG_PATH = path.resolve('agent-sentry/agent-sentry.config.json');

function getConfigPath(): string {
  return resolveConfigPath() ?? DEFAULT_CONFIG_PATH;
}

/** Skill descriptions for onboarding output. */
const SKILL_DESCRIPTIONS: Record<string, string> = {
  save_points: 'Automatic session checkpoints and restore points',
  context_health: 'Context window monitoring and overflow warnings',
  standing_orders: 'Persistent rules enforced across sessions',
  small_bets: 'Task decomposition and risk-aware sizing',
  proactive_safety: 'Security scanning, PII detection, secret scanning',
};

export const enableCommand: CommandDefinition = {
  name: 'enable',
  description: 'Set your AgentSentry enablement level (1-5)',
  usage: [
    'Usage: agent-sentry enable --level <1-5> [options]',
    '',
    '  --level <N>   Set enablement level (1-5)',
    '  --show        Show current level and active skills',
    '  --json        Output in JSON format',
    '',
    'Levels:',
    '  1 — Safe Ground:     Save points only',
    '  2 — Clear Head:      + Context health monitoring',
    '  3 — House Rules:     + Standing orders (basic)',
    '  4 — Right Size:      + Small bets, standing orders (full)',
    '  5 — Full Guard:      All skills at full power',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const json = isJson(args.flags);
    const showOnly = args.flags['show'] === true;

    if (showOnly) {
      const current = loadEnablementLevel();
      const config = generateConfigForLevel(current);
      const active = getActiveSkills(config);
      const next = getNextLevel(config);

      if (json) {
        output({ level: current, name: LEVEL_NAMES[current], active, next }, true);
      } else {
        printCurrentLevel(current, active, next);
      }
      return;
    }

    const levelRaw = args.flags['level'];
    if (levelRaw === undefined || levelRaw === true) {
      // No --level flag: show current + usage
      const current = loadEnablementLevel();
      const config = generateConfigForLevel(current);
      const active = getActiveSkills(config);
      const next = getNextLevel(config);
      printCurrentLevel(current, active, next);
      return;
    }

    const level = typeof levelRaw === 'string' ? parseInt(levelRaw, 10) : NaN;
    if (isNaN(level) || level < 1 || level > 5) {
      process.stderr.write('Error: --level must be an integer between 1 and 5\n');
      process.exitCode = 1;
      return;
    }

    // Apply the level
    const config = generateConfigForLevel(level);
    saveEnablementLevel(level);

    const active = getActiveSkills(config);
    const next = getNextLevel(config);

    if (json) {
      output({ level, name: LEVEL_NAMES[level], config, active, next, applied: true }, true);
    } else {
      process.stdout.write(`\n  AgentSentry Enablement: Level ${level} — ${LEVEL_NAMES[level]}\n`);
      process.stdout.write('  ' + '─'.repeat(50) + '\n\n');
      process.stdout.write('  Active skills:\n');
      for (const skill of active) {
        const mode = config.skills[skill as keyof typeof config.skills]?.mode ?? 'full';
        const desc = SKILL_DESCRIPTIONS[skill] ?? '';
        process.stdout.write(`    [${mode}] ${skill}: ${desc}\n`);
      }

      const inactive = ALL_SKILLS.filter((s) => !active.includes(s));
      if (inactive.length > 0) {
        process.stdout.write('\n  Inactive (unlock at higher levels):\n');
        for (const skill of inactive) {
          const desc = SKILL_DESCRIPTIONS[skill] ?? '';
          process.stdout.write(`    [ - ] ${skill}: ${desc}\n`);
        }
      }

      if (next) {
        process.stdout.write(`\n  Next: Level ${next.level} (${next.name}) unlocks: ${next.unlocks.join(', ')}\n`);
      } else {
        process.stdout.write('\n  You are at maximum enablement.\n');
      }
      process.stdout.write('\n');
    }

    // Store enablement event in MemoryStore (best-effort)
    try {
      const { MemoryStore } = await import('../../memory/store');
      const store = new MemoryStore();
      await store.capture({
        timestamp: new Date().toISOString(),
        session_id: 'enablement',
        agent_id: 'cli',
        event_type: 'decision',
        severity: 'low',
        skill: 'system',
        title: `enablement:set-level:${level}`,
        detail: `Enablement level set to ${level} (${LEVEL_NAMES[level]}). Active skills: ${active.join(', ')}`,
        affected_files: [getConfigPath()],
        tags: ['enablement', 'enablement:level-change'],
        metadata: { level, name: LEVEL_NAMES[level], active },
      });
      await store.close();
    } catch (e) {
      logger.debug('Failed to store enablement event', { error: e instanceof Error ? e.message : String(e) });
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadEnablementLevel(): number {
  try {
    const cfgPath = getConfigPath();
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const level = raw?.enablement?.level;
    if (typeof level === 'number' && level >= 1 && level <= 5) return level;
  } catch (e) {
    logger.debug('Failed to load enablement level from config', { error: e instanceof Error ? e.message : String(e) });
  }
  return 1;
}

function saveEnablementLevel(level: number): void {
  const cfgPath = getConfigPath();
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    logger.debug('Config file not found, starting fresh', { error: e instanceof Error ? e.message : String(e) });
  }

  if (!config.enablement || typeof config.enablement !== 'object') {
    config.enablement = {};
  }
  const canonical = generateConfigForLevel(level);
  (config.enablement as Record<string, unknown>).level = level;
  (config.enablement as Record<string, unknown>).skills = canonical.skills;
  (config.enablement as Record<string, unknown>).updated_at = new Date().toISOString();

  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function printCurrentLevel(
  level: number,
  active: string[],
  next: ReturnType<typeof getNextLevel>,
): void {
  process.stdout.write(`\n  Current level: ${level} — ${LEVEL_NAMES[level]}\n`);
  process.stdout.write(`  Active skills: ${active.length > 0 ? active.join(', ') : '(none)'}\n`);
  if (next) {
    process.stdout.write(`  Next: Level ${next.level} (${next.name}) unlocks: ${next.unlocks.join(', ')}\n`);
  }
  process.stdout.write('\n');
}
