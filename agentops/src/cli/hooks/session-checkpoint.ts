#!/usr/bin/env node
/**
 * session-checkpoint.ts — TypeScript implementation of the session-end checkpoint hook.
 *
 * Runs when a session ends: auto-commits uncommitted changes,
 * resets tracking state files, and logs a session-end event.
 * Always exits 0 (advisory only, never blocks).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'hook-session-checkpoint' });

const PREFIX = '[AgentOps]';
const TMPBASE = path.join(process.env.TMPDIR ?? '/tmp', 'agentops');

function getConfigPath(): string {
  return path.join(__dirname, '..', '..', '..', 'agentops.config.json');
}

function readConfig(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
  } catch (e) {
    logger.debug('Failed to read config file', { error: e instanceof Error ? e.message : String(e) });
    return {};
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

function logEvent(sessionLog: string, msg: string, severity = 'info'): void {
  const timestamp = new Date().toISOString();
  const entry = JSON.stringify({ timestamp, type: 'session-end', message: msg, severity });
  fs.appendFileSync(sessionLog, entry + '\n');
}

function autoCommit(config: Record<string, any>): string {
  if (!isGitRepo()) {
    console.log(`${PREFIX} Not inside a git repository — skipping auto-commit.`);
    return '';
  }

  let changedFiles: number;
  try {
    const porcelain = execSync('git status --porcelain', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    changedFiles = porcelain.split('\n').filter(Boolean).length;
  } catch (e) {
    logger.debug('Failed to get git status', { error: e instanceof Error ? e.message : String(e) });
    return '';
  }

  if (changedFiles === 0) {
    console.log(`${PREFIX} No uncommitted changes.`);
    return '';
  }

  const summary = `${changedFiles} file(s) changed`;
  const commitMsg = `[agentops] session-end checkpoint — ${summary}`;
  const autoEnabled = config?.save_points?.auto_commit_enabled ?? true;

  if (!autoEnabled) {
    console.log(`${PREFIX} Uncommitted changes detected (${summary}). Auto-commit disabled — skipping.`);
    return '';
  }

  console.log(`${PREFIX} Uncommitted changes detected (${summary}). Auto-committing...`);

  try {
    execSync('git add -A -- . ":!*.db" ":!*.db-journal" ":!*.db-wal"', { stdio: 'pipe' });
    execSync(`git commit -m "${commitMsg}" --no-verify`, { stdio: 'pipe' });
    console.log(`${PREFIX} Committed: ${commitMsg}`);
    return commitMsg;
  } catch (e) {
    logger.warn('Auto-commit failed during session checkpoint', { error: e instanceof Error ? e.message : String(e) });
    return '';
  }
}

function resetTrackingState(): void {
  console.log(`${PREFIX} Resetting session state files...`);

  const blastRadius = path.join(TMPBASE, 'blast-radius-files');
  if (fs.existsSync(blastRadius)) {
    fs.unlinkSync(blastRadius);
    console.log(`${PREFIX}  Cleared blast-radius-files`);
  }

  const contextState = path.join(TMPBASE, 'context-state');
  if (fs.existsSync(contextState)) {
    fs.unlinkSync(contextState);
    console.log(`${PREFIX}  Cleared context-state`);
  }

  // Clean up git-hygiene-session files
  if (fs.existsSync(TMPBASE)) {
    let cleared = 0;
    for (const f of fs.readdirSync(TMPBASE)) {
      if (f.startsWith('git-hygiene-session-')) {
        fs.unlinkSync(path.join(TMPBASE, f));
        cleared++;
      }
    }
    if (cleared > 0) {
      console.log(`${PREFIX}  Cleared ${cleared} git-hygiene-session file(s)`);
    }
  }
}

function main(): void {
  const config = readConfig();

  // Ensure dashboard data directory exists
  const dashboardData = path.join(__dirname, '..', '..', '..', 'dashboard', 'data');
  fs.mkdirSync(dashboardData, { recursive: true });
  const sessionLog = path.join(dashboardData, 'session-log.json');

  // Step 1: Auto-commit
  const commitMsg = autoCommit(config);

  // Step 2: Reset tracking state
  resetTrackingState();

  // Step 3: Log session-end event
  if (commitMsg) {
    logEvent(sessionLog, `Session ended with auto-commit: ${commitMsg}`, 'info');
  } else {
    logEvent(sessionLog, 'Session ended cleanly — no uncommitted changes', 'info');
  }

  console.log(`${PREFIX} Session end checkpoint complete.`);
}

main();
process.exit(0);
