#!/usr/bin/env node
/**
 * session-start.ts — TypeScript implementation of the SessionStart hook.
 *
 * Validates rules files, scaffold docs, and git state at session start.
 * Always exits 0 (advisory only, never blocks session start).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { resolveConfigPath } from '../../config/resolve';
import { Logger } from '../../observability/logger';
import { safeJsonParse } from '../../utils/safe-json';
import { safeReadSync } from '../../utils/safe-io';
import { errorMessage } from '../../utils/error-message';

const logger = new Logger({ module: 'hook-session-start' });

const PREFIX = '[AgentSentry]';

interface CheckResults {
  criticals: string[];
  warnings: string[];
  advisories: string[];
}

function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    logger.debug('Failed to get repo root via git', { error: errorMessage(e) });
    return process.cwd();
  }
}

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch (e) {
    logger.debug('Not inside a git repository', { error: errorMessage(e) });
    return false;
  }
}

function readConfig(): { claudeMdMaxLines: number; agentsMdMaxLines: number } {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return { claudeMdMaxLines: 300, agentsMdMaxLines: 300 };
  }
  try {
    const config = safeJsonParse<Record<string, Record<string, unknown>>>(safeReadSync(configPath).toString('utf-8'));
    const rulesFile = config.rules_file;
    return {
      claudeMdMaxLines: (rulesFile?.claude_md_max_lines ?? rulesFile?.max_lines ?? 300) as number,
      agentsMdMaxLines: (rulesFile?.agents_md_max_lines ?? rulesFile?.max_lines ?? 300) as number,
    };
  } catch (e) {
    logger.debug('Failed to read config file', { error: errorMessage(e) });
    return { claudeMdMaxLines: 300, agentsMdMaxLines: 300 };
  }
}

function checkGitState(results: CheckResults): void {
  if (!isGitRepo()) {
    results.criticals.push("No git repository. Run 'git init' and commit before proceeding.");
    return;
  }

  let branch: string;
  try {
    branch = execSync('git branch --show-current', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || 'detached';
  } catch (e) {
    logger.debug('Failed to get current git branch', { error: errorMessage(e) });
    branch = 'detached';
  }

  try {
    const porcelain = execSync('git status --porcelain', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const uncommitted = porcelain.split('\n').filter(Boolean).length;
    if (uncommitted > 0) {
      results.advisories.push(`${uncommitted} uncommitted changes on branch '${branch}'.`);
    }
  } catch (e) {
    logger.debug('Failed to get git status', { error: errorMessage(e) });
  }
}

function checkClaudeMd(repoRoot: string, maxLines: number, results: CheckResults): void {
  const claudeMd = path.join(repoRoot, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) {
    results.warnings.push('CLAUDE.md missing. Create one with project rules and agent configuration for best results.');
    return;
  }

  const content = safeReadSync(claudeMd).toString('utf-8');
  const lineCount = content.split('\n').length;

  if (lineCount > maxLines) {
    results.warnings.push(`CLAUDE.md is ${lineCount} lines (recommended: <${maxLines}). Large rules files consume context.`);
  }

  if (!/agent.sentry/i.test(content)) {
    results.advisories.push('CLAUDE.md has no AgentSentry rules. Run /agent-sentry scaffold to add them.');
  }

  const requiredSections = ['security', 'error handling'];
  for (const section of requiredSections) {
    if (!new RegExp(section, 'i').test(content)) {
      results.warnings.push(`CLAUDE.md missing '${section}' section.`);
    }
  }
}

function checkAgentsMd(repoRoot: string, maxLines: number, results: CheckResults): void {
  const agentsMd = path.join(repoRoot, 'AGENTS.md');
  if (!fs.existsSync(agentsMd)) {
    results.warnings.push('No AGENTS.md found. Cross-tool agent rules are not configured.');
    return;
  }

  const lineCount = safeReadSync(agentsMd).toString('utf-8').split('\n').length;
  if (lineCount > maxLines) {
    results.warnings.push(`AGENTS.md is ${lineCount} lines (recommended: <${maxLines}).`);
  }
}

function checkScaffoldDocs(repoRoot: string, results: CheckResults): void {
  const docs = ['PLANNING.md', 'TASKS.md', 'CONTEXT.md', 'WORKFLOW.md'];
  const missing = docs.filter((d) => !fs.existsSync(path.join(repoRoot, d)));

  if (missing.length > 0) {
    results.advisories.push(`Missing scaffold docs: ${missing.join(' ')}. Run /agent-sentry scaffold to create them.`);
  }

  // Check CONTEXT.md freshness
  const contextMd = path.join(repoRoot, 'CONTEXT.md');
  if (fs.existsSync(contextMd)) {
    const stat = fs.statSync(contextMd);
    const daysStale = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
    if (daysStale > 7) {
      results.advisories.push(`CONTEXT.md last updated ${daysStale} days ago. Run /agent-sentry scaffold to refresh.`);
    }
  }
}

function main(): void {
  const config = readConfig();
  const repoRoot = getRepoRoot();

  const results: CheckResults = {
    criticals: [],
    warnings: [],
    advisories: [],
  };

  checkGitState(results);
  checkClaudeMd(repoRoot, config.claudeMdMaxLines, results);
  checkAgentsMd(repoRoot, config.agentsMdMaxLines, results);
  checkScaffoldDocs(repoRoot, results);

  // User-facing hook UI — rendered by Claude Code in the session-start pane.
  // Written to stdout directly (not via Logger) because Logger emits JSON-lines
  // to stderr and Claude Code surfaces hook stdout, not stderr.
  const out = (s: string) => process.stdout.write(s + '\n');
  out(`${PREFIX} Session Start Health Check`);
  out('───────────────────────────────────────────────');

  for (const c of results.criticals) {
    out(`  \u2717 CRITICAL: ${c}`);
  }
  for (const w of results.warnings) {
    out(`  \u25B2 WARNING: ${w}`);
  }
  for (const a of results.advisories) {
    out(`  \u25CB ADVISORY: ${a}`);
  }

  if (results.criticals.length + results.warnings.length + results.advisories.length === 0) {
    out('  \u2713 All checks passed.');
  }

  out('───────────────────────────────────────────────');
  out(`${PREFIX} ${results.criticals.length} critical, ${results.warnings.length} warnings, ${results.advisories.length} advisories`);

  // Also emit a structured log summary for downstream consumers.
  logger.info('Session start health check complete', {
    criticals: results.criticals.length,
    warnings: results.warnings.length,
    advisories: results.advisories.length,
  });
}

main();
process.exit(0);
