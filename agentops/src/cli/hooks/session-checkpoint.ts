#!/usr/bin/env node
/**
 * session-checkpoint.ts — TypeScript implementation of the session-end checkpoint hook.
 *
 * Runs when a session ends: creates a git stash snapshot of uncommitted changes,
 * resets tracking state files, and logs a session-end event with the snapshot SHA.
 * Always exits 0 (advisory only, never blocks).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { resolveConfigPath } from '../../config/resolve';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'hook-session-checkpoint' });

const PREFIX = '[AgentSentry]';
const TMPBASE = path.join(process.env.TMPDIR ?? '/tmp', 'agentops');

function readConfig(): Record<string, unknown> {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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

function stashSnapshot(config: Record<string, unknown>): string {
  if (!isGitRepo()) {
    console.log(`${PREFIX} Not inside a git repository — skipping snapshot.`);
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
  const savePoints = config?.save_points as Record<string, unknown> | undefined;
  const autoEnabled = savePoints?.auto_commit_enabled ?? true;

  if (!autoEnabled) {
    console.log(`${PREFIX} Uncommitted changes detected (${summary}). Auto-snapshot disabled — skipping.`);
    return '';
  }

  console.log(`${PREFIX} Uncommitted changes detected (${summary}). Creating stash snapshot...`);

  try {
    // Stage everything so git stash create captures all changes (including untracked)
    execSync('git add -A -- . ":!*.db" ":!*.db-journal" ":!*.db-wal"', { stdio: 'pipe' });

    // git stash create: produces a SHA without modifying HEAD or the stash reflog
    const sha = execSync('git stash create', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    // Unstage so the working tree stays dirty (stash create doesn't reset)
    execSync('git reset HEAD', { stdio: 'pipe' });

    if (!sha) {
      console.log(`${PREFIX} git stash create returned empty — no snapshot needed.`);
      return '';
    }

    // Protect the SHA from garbage collection by storing it in the stash reflog
    const stashMsg = `AgentOps checkpoint — ${summary}`;
    execSync(`git stash store -m "${stashMsg}" ${sha}`, { stdio: 'pipe' });

    console.log(`${PREFIX} Snapshot created: ${sha} (${summary})`);
    return sha;
  } catch (e) {
    logger.warn('Stash snapshot failed during session checkpoint', { error: e instanceof Error ? e.message : String(e) });
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

async function autoSaveHandoff(): Promise<void> {
  try {
    const { generateHandoffResult, saveHandoffToMemory } = await import('../commands/handoff');
    const result = await generateHandoffResult();
    const savedPath = saveHandoffToMemory(result);
    if (savedPath) {
      console.log(`${PREFIX} Auto-saved handoff: ${savedPath}`);
    } else {
      console.log(`${PREFIX} Could not resolve memory directory — handoff not saved.`);
    }
  } catch (e) {
    logger.debug('Auto-save handoff failed', { error: e instanceof Error ? e.message : String(e) });
    console.log(`${PREFIX} Auto-save handoff skipped (not critical).`);
  }
}

async function main(): Promise<void> {
  const config = readConfig();

  // Ensure dashboard data directory exists
  const dashboardData = path.join(__dirname, '..', '..', '..', 'dashboard', 'data');
  fs.mkdirSync(dashboardData, { recursive: true });
  const sessionLog = path.join(dashboardData, 'session-log.json');

  // Step 1: Create stash snapshot (replaces auto-commit)
  const snapshotSha = stashSnapshot(config);

  // Step 2: Reset tracking state
  resetTrackingState();

  // Step 3: Auto-save handoff for next session
  await autoSaveHandoff();

  // Step 4: Log session-end event with snapshot SHA
  if (snapshotSha) {
    logEvent(sessionLog, `Session ended with stash snapshot: ${snapshotSha}`, 'info');
  } else {
    logEvent(sessionLog, 'Session ended cleanly — no uncommitted changes', 'info');
  }

  console.log(`${PREFIX} Session end checkpoint complete.`);
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
