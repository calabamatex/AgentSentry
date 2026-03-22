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
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'hook-session-start' });

const PREFIX = '[AgentOps]';

interface CheckResults {
  criticals: string[];
  warnings: string[];
  advisories: string[];
}

function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    logger.debug('Failed to get repo root via git', { error: e instanceof Error ? e.message : String(e) });
    return process.cwd();
  }
}

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch (e) {
    logger.debug('Not inside a git repository', { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

function readConfig(): { claudeMdMaxLines: number; agentsMdMaxLines: number } {
  const configPath = path.join(__dirname, '..', '..', '..', 'agentops.config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      claudeMdMaxLines: config.rules_file?.claude_md_max_lines ?? config.rules_file?.max_lines ?? 300,
      agentsMdMaxLines: config.rules_file?.agents_md_max_lines ?? config.rules_file?.max_lines ?? 300,
    };
  } catch (e) {
    logger.debug('Failed to read config file', { error: e instanceof Error ? e.message : String(e) });
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
    logger.debug('Failed to get current git branch', { error: e instanceof Error ? e.message : String(e) });
    branch = 'detached';
  }

  try {
    const porcelain = execSync('git status --porcelain', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const uncommitted = porcelain.split('\n').filter(Boolean).length;
    if (uncommitted > 0) {
      results.advisories.push(`${uncommitted} uncommitted changes on branch '${branch}'.`);
    }
  } catch (e) {
    logger.debug('Failed to get git status', { error: e instanceof Error ? e.message : String(e) });
  }
}

function checkClaudeMd(repoRoot: string, maxLines: number, results: CheckResults): void {
  const claudeMd = path.join(repoRoot, 'CLAUDE.md');
  if (!fs.existsSync(claudeMd)) {
    results.warnings.push('CLAUDE.md missing. Create one with project rules and agent configuration for best results.');
    return;
  }

  const content = fs.readFileSync(claudeMd, 'utf-8');
  const lineCount = content.split('\n').length;

  if (lineCount > maxLines) {
    results.warnings.push(`CLAUDE.md is ${lineCount} lines (recommended: <${maxLines}). Large rules files consume context.`);
  }

  if (!/agentops/i.test(content)) {
    results.advisories.push('CLAUDE.md has no AgentOps rules. Run /agentops scaffold to add them.');
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

  const lineCount = fs.readFileSync(agentsMd, 'utf-8').split('\n').length;
  if (lineCount > maxLines) {
    results.warnings.push(`AGENTS.md is ${lineCount} lines (recommended: <${maxLines}).`);
  }
}

function checkScaffoldDocs(repoRoot: string, results: CheckResults): void {
  const docs = ['PLANNING.md', 'TASKS.md', 'CONTEXT.md', 'WORKFLOW.md'];
  const missing = docs.filter((d) => !fs.existsSync(path.join(repoRoot, d)));

  if (missing.length > 0) {
    results.advisories.push(`Missing scaffold docs: ${missing.join(' ')}. Run /agentops scaffold to create them.`);
  }

  // Check CONTEXT.md freshness
  const contextMd = path.join(repoRoot, 'CONTEXT.md');
  if (fs.existsSync(contextMd)) {
    const stat = fs.statSync(contextMd);
    const daysStale = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
    if (daysStale > 7) {
      results.advisories.push(`CONTEXT.md last updated ${daysStale} days ago. Run /agentops scaffold to refresh.`);
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

  // Output
  console.log(`${PREFIX} Session Start Health Check`);
  console.log('───────────────────────────────────────────────');

  for (const c of results.criticals) {
    console.log(`  \u2717 CRITICAL: ${c}`);
  }
  for (const w of results.warnings) {
    console.log(`  \u25B2 WARNING: ${w}`);
  }
  for (const a of results.advisories) {
    console.log(`  \u25CB ADVISORY: ${a}`);
  }

  if (results.criticals.length + results.warnings.length + results.advisories.length === 0) {
    console.log('  \u2713 All checks passed.');
  }

  console.log('───────────────────────────────────────────────');
  console.log(`${PREFIX} ${results.criticals.length} critical, ${results.warnings.length} warnings, ${results.advisories.length} advisories`);
}

main();
process.exit(0);
