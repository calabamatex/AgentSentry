/**
 * init-wizard.ts — Interactive wizard and helper functions extracted from init.ts.
 *
 * Houses the interactive level prompt, hook wiring, health audit,
 * and git detection to keep init.ts under 500 lines.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';
import { generateConfigForLevel, getActiveSkills, LEVEL_NAMES } from '../../enablement/engine';
import { safeJsonParse } from '../../utils/safe-json';

export interface HealthSummary {
  criticals: string[];
  warnings: string[];
  advisories: string[];
}

export function isGitRepo(): boolean {
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
export async function promptForLevel(): Promise<number> {
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
export function wireHooksIntoSettings(): boolean {
  const settingsPath = path.join('.claude', 'settings.json');
  let settings: Record<string, unknown>;

  try {
    if (fs.existsSync(settingsPath)) {
      settings = safeJsonParse<Record<string, unknown>>(fs.readFileSync(settingsPath, 'utf-8'));
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
    Stop: {
      command: 'bash agent-sentry/scripts/context-critical-stop.sh',
      timeout: 5000,
    },
  };

  for (const [event, hookDef] of Object.entries(agentSentryHooks)) {
    const existing = hooks[event] as Array<{ hooks?: Array<{ command?: string }> }> | undefined;

    // Check if the agent-sentry hook is already present
    const alreadyWired = existing?.some((group) =>
      group.hooks?.some((h) => h.command?.includes('agent-sentry/'))
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

/**
 * AgentSentry CLAUDE.md rules block — appended to CLAUDE.md by `agent-sentry init`.
 * Includes the directive compliance rule (Level 3+).
 */
export const AGENT_SENTRY_CLAUDE_MD_RULES = `
## AgentSentry — Directive Compliance

When AgentSentry hook output contains ACTION or RECOMMEND directives, execute the
specified tool or command immediately. Do not substitute alternatives or defer action.

- **ACTION directives** are mandatory: run the exact tool/command specified.
- **RECOMMEND directives** are strongly advised: follow unless you have an explicit
  user instruction that contradicts them.
- **BLOCKED directives** from Stop hooks are enforced automatically — the agent cannot
  continue until the blocking condition is resolved.

This is a standing order at enablement Level 3+ (House Rules).
`.trim();

/**
 * Append AgentSentry rules to CLAUDE.md if not already present.
 * Returns true if the file was modified.
 */
export function appendAgentSentryRulesToClaudeMd(repoRoot: string): boolean {
  const claudeMd = path.join(repoRoot, 'CLAUDE.md');

  if (!fs.existsSync(claudeMd)) {
    return false;
  }

  const content = fs.readFileSync(claudeMd, 'utf-8');

  // Already has directive compliance rules
  if (/directive.compliance|ACTION.*RECOMMEND.*immediately/i.test(content)) {
    return false;
  }

  fs.appendFileSync(claudeMd, '\n\n' + AGENT_SENTRY_CLAUDE_MD_RULES + '\n', 'utf-8');
  return true;
}

export function runHealthAudit(): HealthSummary {
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
