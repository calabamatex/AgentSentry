/**
 * init.ts — CLI command: onboarding wizard for AgentOps.
 *
 * `agentops init` scaffolds config, sets enablement level, wires hooks,
 * runs a first health audit, and shows next steps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { CommandDefinition, ParsedArgs, output, isJson } from '../parser';
import { resolveConfigPath } from '../../config/resolve';
import { generateConfigForLevel, getActiveSkills, LEVEL_NAMES, ALL_SKILLS } from '../../enablement/engine';
import { VERSION } from '../../version';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'cli-init' });

const DEFAULT_CONFIG_PATH = path.resolve('agentops/agentops.config.json');

/** Minimal default config scaffolded by `agentops init`. */
function defaultConfig(level: number): Record<string, unknown> {
  return {
    save_points: {
      auto_commit_enabled: false,
      auto_commit_after_minutes: 30,
      auto_branch_on_risk_score: 8,
      max_uncommitted_files_warning: 5,
    },
    context_health: {
      message_count_warning: 20,
      message_count_critical: 30,
      context_percent_warning: 60,
      context_percent_critical: 80,
    },
    rules_file: {
      max_lines: 300,
      required_sections: ['security', 'error handling'],
    },
    task_sizing: {
      medium_risk_threshold: 4,
      high_risk_threshold: 8,
      critical_risk_threshold: 13,
      max_files_per_task_warning: 5,
      max_files_per_task_critical: 8,
    },
    security: {
      block_on_secret_detection: true,
      scan_git_history: false,
      check_common_provider_keys: true,
      permission_fail_mode: 'block',
      suppressions: [],
      exclude_paths: ['node_modules/**', 'vendor/**', '.git/**', '*.min.js', '*.min.css'],
    },
    budget: {
      session_budget: 10,
      monthly_budget: 500,
      warn_threshold: 0.8,
    },
    notifications: {
      verbose: false,
      prefix_all_messages: '[AgentOps]',
    },
    memory: {
      enabled: true,
      provider: 'sqlite',
      embedding_provider: 'auto',
      database_path: 'agentops/data/ops.db',
      max_events: 100000,
      auto_prune_days: 365,
    },
    enablement: {
      level,
      skills: generateConfigForLevel(level).skills,
      updated_at: new Date().toISOString(),
    },
  };
}

interface InitResult {
  config_path: string;
  config_created: boolean;
  level: number;
  level_name: string;
  active_skills: string[];
  git_repo: boolean;
  health: HealthSummary;
  hooks_hint: string;
}

interface HealthSummary {
  criticals: string[];
  warnings: string[];
  advisories: string[];
}

export const initCommand: CommandDefinition = {
  name: 'init',
  description: 'Initialize AgentOps in this project',
  usage: [
    'Usage: agentops init [options]',
    '',
    'Options:',
    '  --level <1-5>   Starting enablement level (default: 1)',
    '  --force         Overwrite existing config file',
    '  --json          Output in JSON format',
    '',
    'What it does:',
    '  1. Creates agentops.config.json with sensible defaults',
    '  2. Sets your enablement level (progressive skill adoption)',
    '  3. Runs a quick health audit of your project',
    '  4. Shows how to wire session hooks',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const json = isJson(args.flags);
    const force = args.flags['force'] === true;

    // Parse level
    const levelRaw = args.flags['level'];
    let level = 1;
    if (levelRaw !== undefined && levelRaw !== true) {
      const parsed = typeof levelRaw === 'string' ? parseInt(levelRaw, 10) : NaN;
      if (isNaN(parsed) || parsed < 1 || parsed > 5) {
        process.stderr.write('Error: --level must be an integer between 1 and 5\n');
        process.exitCode = 1;
        return;
      }
      level = parsed;
    }

    // Step 1: Scaffold config
    const configPath = resolveConfigPath() ?? DEFAULT_CONFIG_PATH;
    const configExists = fs.existsSync(configPath);
    let configCreated = false;

    if (!configExists || force) {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (configExists && !force) {
        // Should not reach here, but safety check
      } else {
        const config = defaultConfig(level);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        configCreated = true;
      }
    } else {
      // Config exists — update enablement level
      try {
        const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!existing.enablement || typeof existing.enablement !== 'object') {
          existing.enablement = {};
        }
        const canonical = generateConfigForLevel(level);
        existing.enablement.level = level;
        existing.enablement.skills = canonical.skills;
        existing.enablement.updated_at = new Date().toISOString();
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
      } catch (e) {
        logger.debug('Failed to update existing config', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Step 2: Gather info
    const activeSkills = getActiveSkills(generateConfigForLevel(level));
    const gitRepo = isGitRepo();

    // Step 3: Quick health audit
    const health = runHealthAudit();

    // Step 4: Hooks hint
    const hooksHint = [
      'Add to .claude/settings.json → hooks.SessionStart:',
      '  "command": "node agentops/dist/src/cli/hooks/session-start.js"',
    ].join('\n');

    const result: InitResult = {
      config_path: configPath,
      config_created: configCreated,
      level,
      level_name: LEVEL_NAMES[level],
      active_skills: activeSkills,
      git_repo: gitRepo,
      health,
      hooks_hint: hooksHint,
    };

    if (json) {
      output(result, true);
      return;
    }

    // Pretty output
    const w = (s: string) => process.stdout.write(s);
    w('\n');
    w(`  AgentOps v${VERSION} — Project Initialized\n`);
    w('  ' + '═'.repeat(50) + '\n\n');

    // Config
    if (configCreated) {
      w(`  ✓ Config created: ${configPath}\n`);
    } else {
      w(`  ✓ Config updated: ${configPath}\n`);
    }

    // Enablement
    w(`  ✓ Enablement: Level ${level} — ${LEVEL_NAMES[level]}\n`);
    w(`    Active skills: ${activeSkills.length > 0 ? activeSkills.join(', ') : '(none)'}\n`);
    const inactive = ALL_SKILLS.filter((s) => !activeSkills.includes(s));
    if (inactive.length > 0) {
      w(`    Locked: ${inactive.join(', ')}\n`);
    }

    // Git
    w(`  ${gitRepo ? '✓' : '✗'} Git repository: ${gitRepo ? 'detected' : 'not found — run git init'}\n`);

    // Health audit
    w('\n  Health Audit\n');
    w('  ' + '─'.repeat(50) + '\n');

    const total = health.criticals.length + health.warnings.length + health.advisories.length;
    if (total === 0) {
      w('  ✓ All checks passed\n');
    } else {
      for (const c of health.criticals) {
        w(`  ✗ CRITICAL: ${c}\n`);
      }
      for (const warn of health.warnings) {
        w(`  ▲ WARNING: ${warn}\n`);
      }
      for (const a of health.advisories) {
        w(`  ○ ADVISORY: ${a}\n`);
      }
    }

    // Next steps
    w('\n  Next Steps\n');
    w('  ' + '─'.repeat(50) + '\n');
    w('  1. Wire session hooks (see below)\n');
    w('  2. Run: agentops health\n');
    w('  3. Run: agentops dashboard\n');
    if (level < 5) {
      w(`  4. Level up: agentops enable --level ${level + 1}\n`);
    }

    // Hook wiring
    w('\n  Hook Wiring\n');
    w('  ' + '─'.repeat(50) + '\n');
    w('  ' + hooksHint.split('\n').join('\n  ') + '\n');
    w('\n');

    // Store init event (best-effort)
    try {
      const { MemoryStore } = await import('../../memory/store');
      const store = new MemoryStore();
      await store.capture({
        timestamp: new Date().toISOString(),
        session_id: 'init',
        agent_id: 'cli',
        event_type: 'decision',
        severity: 'low',
        skill: 'system',
        title: 'agentops:init',
        detail: `Project initialized at level ${level} (${LEVEL_NAMES[level]}). Config: ${configCreated ? 'created' : 'updated'}. Skills: ${activeSkills.join(', ')}`,
        affected_files: [configPath],
        tags: ['init', 'enablement'],
        metadata: { level, config_created: configCreated },
      });
      await store.close();
    } catch (e) {
      logger.debug('Failed to store init event', { error: e instanceof Error ? e.message : String(e) });
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function runHealthAudit(): HealthSummary {
  const results: HealthSummary = {
    criticals: [],
    warnings: [],
    advisories: [],
  };

  // Git check
  if (!isGitRepo()) {
    results.criticals.push("No git repository. Run 'git init' before proceeding.");
    return results;
  }

  // Repo root
  let repoRoot: string;
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    repoRoot = process.cwd();
  }

  // CLAUDE.md
  const claudeMd = path.join(repoRoot, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) {
    results.warnings.push('CLAUDE.md missing. Create one with project rules.');
  } else {
    const content = fs.readFileSync(claudeMd, 'utf-8');
    if (!/agentops/i.test(content)) {
      results.advisories.push('CLAUDE.md has no AgentOps rules.');
    }
    for (const section of ['security', 'error handling']) {
      if (!new RegExp(section, 'i').test(content)) {
        results.warnings.push(`CLAUDE.md missing '${section}' section.`);
      }
    }
  }

  // Uncommitted changes
  try {
    const porcelain = execSync('git status --porcelain', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const uncommitted = porcelain.split('\n').filter(Boolean).length;
    if (uncommitted > 0) {
      results.advisories.push(`${uncommitted} uncommitted changes.`);
    }
  } catch {
    // Ignore
  }

  // Scaffold docs
  const docs = ['PLANNING.md', 'TASKS.md', 'CONTEXT.md', 'WORKFLOW.md'];
  const missing = docs.filter((d) => !fs.existsSync(path.join(repoRoot, d)));
  if (missing.length > 0) {
    results.advisories.push(`Missing scaffold docs: ${missing.join(', ')}.`);
  }

  return results;
}
