/**
 * init.ts — CLI command: onboarding wizard for AgentSentry.
 *
 * `agent-sentry init` scaffolds config, sets enablement level, wires hooks,
 * runs a first health audit, and shows next steps.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';
import { CommandDefinition, ParsedArgs, output, isJson } from '../parser';
import { resolveConfigPath } from '../../config/resolve';
import { generateConfigForLevel, getActiveSkills, LEVEL_NAMES, ALL_SKILLS } from '../../enablement/engine';
import { VERSION } from '../../version';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'cli-init' });

const DEFAULT_CONFIG_PATH = path.resolve('agent-sentry/agent-sentry.config.json');

/** Minimal default config scaffolded by `agent-sentry init`. */
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
      prefix_all_messages: '[AgentSentry]',
    },
    memory: {
      enabled: true,
      provider: 'sqlite',
      embedding_provider: 'auto',
      database_path: 'agent-sentry/data/ops.db',
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
  dry_run: boolean;
  level: number;
  level_name: string;
  active_skills: string[];
  git_repo: boolean;
  health: HealthSummary;
  hooks_hint: string;
  hooks_wired: boolean;
}

interface HealthSummary {
  criticals: string[];
  warnings: string[];
  advisories: string[];
}

export const initCommand: CommandDefinition = {
  name: 'init',
  description: 'Initialize AgentSentry in this project',
  usage: [
    'Usage: agent-sentry init [options]',
    '',
    'Options:',
    '  --level <1-5>      Starting enablement level (default: 1)',
    '  --interactive, -i  Prompt for level choice interactively',
    '  --dry-run          Preview what would be created without writing',
    '  --wire-hooks       Auto-wire AgentSentry hooks into .claude/settings.json',
    '  --force            Overwrite existing config file',
    '  --json             Output in JSON format',
    '',
    'What it does:',
    '  1. Creates agent-sentry.config.json with sensible defaults',
    '  2. Sets your enablement level (progressive skill adoption)',
    '  3. Runs a quick health audit of your project',
    '  4. Optionally wires session hooks into .claude/settings.json',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const json = isJson(args.flags);
    const force = args.flags['force'] === true;
    const dryRun = args.flags['dry-run'] === true;
    const interactive = args.flags['interactive'] === true || args.flags['i'] === true;
    const wireHooks = args.flags['wire-hooks'] === true;

    // Parse level — interactive mode overrides --level
    let level = 1;
    if (interactive && !json) {
      level = await promptForLevel();
    } else {
      const levelRaw = args.flags['level'];
      if (levelRaw !== undefined && levelRaw !== true) {
        const parsed = typeof levelRaw === 'string' ? parseInt(levelRaw, 10) : NaN;
        if (isNaN(parsed) || parsed < 1 || parsed > 5) {
          process.stderr.write('Error: --level must be an integer between 1 and 5\n');
          process.exitCode = 1;
          return;
        }
        level = parsed;
      }
    }

    // Step 1: Scaffold config
    const configPath = resolveConfigPath() ?? DEFAULT_CONFIG_PATH;
    const configExists = fs.existsSync(configPath);
    let configCreated = false;

    if (!dryRun) {
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
    } else {
      // Dry run — pretend config would be created if it doesn't exist
      configCreated = !configExists;
    }

    // Step 1b: Auto-wire hooks if requested
    let hooksWired = false;
    if (wireHooks && !dryRun) {
      hooksWired = wireHooksIntoSettings();
    }

    // Step 2: Gather info
    const activeSkills = getActiveSkills(generateConfigForLevel(level));
    const gitRepo = isGitRepo();

    // Step 3: Quick health audit
    const health = runHealthAudit();

    // Step 4: Hooks hint
    const hooksHint = [
      'Add to .claude/settings.json → hooks.SessionStart:',
      '  "command": "node agent-sentry/dist/src/cli/hooks/session-start.js"',
    ].join('\n');

    const result: InitResult = {
      config_path: configPath,
      config_created: configCreated,
      dry_run: dryRun,
      level,
      level_name: LEVEL_NAMES[level],
      active_skills: activeSkills,
      git_repo: gitRepo,
      health,
      hooks_hint: hooksHint,
      hooks_wired: hooksWired,
    };

    if (json) {
      output(result, true);
      return;
    }

    // Pretty output
    const w = (s: string) => process.stdout.write(s);
    w('\n');
    if (dryRun) {
      w(`  AgentSentry v${VERSION} — Dry Run Preview\n`);
    } else {
      w(`  AgentSentry v${VERSION} — Project Initialized\n`);
    }
    w('  ' + '═'.repeat(50) + '\n\n');

    if (dryRun) {
      w('  [DRY RUN] No files will be written.\n\n');
    }

    // Config
    if (dryRun) {
      w(`  → Would ${configExists ? 'update' : 'create'}: ${configPath}\n`);
    } else if (configCreated) {
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
    w('  2. Run: agent-sentry health\n');
    w('  3. Run: agent-sentry dashboard\n');
    if (level < 5) {
      w(`  4. Level up: agent-sentry enable --level ${level + 1}\n`);
    }

    // Hook wiring
    w('\n  Hook Wiring\n');
    w('  ' + '─'.repeat(50) + '\n');
    if (hooksWired) {
      w('  ✓ Hooks auto-wired into .claude/settings.json\n');
    } else if (wireHooks && dryRun) {
      w('  → Would wire hooks into .claude/settings.json\n');
    } else {
      w('  ' + hooksHint.split('\n').join('\n  ') + '\n');
      w('  Tip: Run with --wire-hooks to auto-wire hooks.\n');
    }
    w('\n');

    // Store init event (best-effort, skip in dry run)
    if (dryRun) return;
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
        title: 'agent-sentry:init',
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

/**
 * Interactive prompt: ask user to choose an enablement level.
 * Falls back to level 1 if stdin is not a TTY or on error.
 */
async function promptForLevel(): Promise<number> {
  const w = (s: string) => process.stdout.write(s);
  w('\n  Choose your enablement level:\n\n');
  for (let i = 1; i <= 5; i++) {
    const skills = getActiveSkills(generateConfigForLevel(i));
    w(`    ${i}. ${LEVEL_NAMES[i]} — ${skills.length > 0 ? skills.join(', ') : 'no skills'}\n`);
  }
  w('\n');

  return new Promise<number>((resolve) => {
    // If stdin is not a TTY (e.g. piped input, CI), default to 1
    if (!process.stdin.isTTY) {
      w('  (non-interactive, defaulting to level 1)\n');
      resolve(1);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('  Select level [1-5] (default: 1): ', (answer) => {
      rl.close();
      const parsed = parseInt(answer.trim(), 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 5) {
        resolve(1);
      } else {
        resolve(parsed);
      }
    });

    // Timeout after 30 seconds — default to 1
    setTimeout(() => {
      rl.close();
      resolve(1);
    }, 30_000);
  });
}

/**
 * Auto-wire AgentSentry hooks into .claude/settings.json.
 * Adds SessionStart and SessionEnd hooks if not already present.
 * Returns true if hooks were added.
 */
function wireHooksIntoSettings(): boolean {
  const settingsPath = path.join('.claude', 'settings.json');
  let settings: Record<string, unknown>;

  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } else {
      // Create .claude dir if needed
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      settings = {};
    }
  } catch {
    return false;
  }

  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }

  const hooks = settings.hooks as Record<string, unknown>;
  let modified = false;

  // Define the AgentSentry hooks to wire
  const agentSentryHooks: Record<string, { command: string; timeout: number }> = {
    SessionStart: {
      command: 'bash agent-sentry/scripts/session-start-checks.sh',
      timeout: 10000,
    },
    UserPromptSubmit: {
      command: 'bash agent-sentry/scripts/context-estimator.sh',
      timeout: 5000,
    },
  };

  for (const [event, hookDef] of Object.entries(agentSentryHooks)) {
    const existing = hooks[event] as Array<{ hooks?: Array<{ command?: string }> }> | undefined;

    // Check if the agentops hook is already present
    const alreadyWired = existing?.some((group) =>
      group.hooks?.some((h) => h.command?.includes('agentops/'))
    );

    if (!alreadyWired) {
      if (!Array.isArray(hooks[event])) {
        hooks[event] = [];
      }
      (hooks[event] as Array<unknown>).push({
        hooks: [
          {
            type: 'command',
            command: hookDef.command,
            timeout: hookDef.timeout,
          },
        ],
      });
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  }

  return modified;
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
    if (!/agent.sentry/i.test(content)) {
      results.advisories.push('CLAUDE.md has no AgentSentry rules.');
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
