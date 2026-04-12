#!/usr/bin/env node
/**
 * post-write.ts — TypeScript implementation of the PostToolUse hook for Write|Edit.
 *
 * Implements:
 *   - Error Handling Enforcer (via analyzers/error-handling)
 *   - PII Logging Scanner (via analyzers/pii-scanner)
 *   - Blast Radius Tracking
 *
 * Reads hook JSON from stdin, extracts .tool_input.file_path.
 * All output prefixed with [AgentSentry]. Always exits 0.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';
import { scanErrorHandling } from '../../analyzers/error-handling';
import { scanPiiLogging } from '../../analyzers/pii-scanner';
import { resolveConfigPath, isGloballyEnabled } from '../../config/resolve';
import { Logger } from '../../observability/logger';
import { safeJsonParse } from '../../utils/safe-json';
import { safeReadSync } from '../../utils/safe-io';
import { errorMessage } from '../../utils/error-message';

const logger = new Logger({ module: 'hook-post-write' });

const PREFIX = '[AgentSentry]';

// User-facing hook UI — rendered by Claude Code.
// Writes to stdout directly (not via Logger, which writes JSON to stderr).
const out = (s: string) => process.stdout.write(s + '\n');

interface HookInput {
  tool_input?: { file_path?: string };
  input?: { file_path?: string };
}

function readConfig(): Record<string, unknown> {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return {};
  }
  try {
    return safeJsonParse<Record<string, unknown>>(safeReadSync(configPath).toString('utf-8'));
  } catch (e) {
    logger.debug('Failed to read config file', { error: errorMessage(e) });
    return {};
  }
}

function checkBlastRadius(filePath: string): void {
  const tmpBase = path.join(process.env.TMPDIR ?? '/tmp', 'agent-sentry');
  const trackingFile = path.join(tmpBase, 'blast-radius-files');

  fs.mkdirSync(tmpBase, { recursive: true });

  // Append the modified file
  fs.appendFileSync(trackingFile, filePath + '\n');

  // Count unique files
  let lines: string[];
  try {
    lines = safeReadSync(trackingFile).toString('utf-8').split('\n').filter(Boolean);
  } catch (e) {
    logger.debug('Failed to read blast-radius tracking file', { error: errorMessage(e) });
    return;
  }
  const uniqueFiles = [...new Set(lines)];
  const uniqueCount = uniqueFiles.length;

  if (uniqueCount <= 8) return;

  // Check if there has been a commit since session start
  const sessionMarker = path.join(tmpBase, 'session-start-time');
  let needsCheckpoint = true;

  if (fs.existsSync(sessionMarker)) {
    try {
      const sessionStart = safeReadSync(sessionMarker).toString('utf-8').trim();
      const recentCommits = execFileSync('git', ['log', '--after=' + sessionStart, '--oneline'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (recentCommits) needsCheckpoint = false;
    } catch (e) {
      logger.debug('Git log check failed, git may not be available', { error: errorMessage(e) });
    }
  }

  if (!needsCheckpoint) return;

  out(`${PREFIX} WARN: ${uniqueCount} files modified without a checkpoint. Creating stash snapshot.`);

  const config = readConfig();
  const savePoints = config?.save_points as Record<string, unknown> | undefined;
  const autoEnabled = savePoints?.auto_commit_enabled ?? true;

  if (!autoEnabled) {
    out(`${PREFIX} ADVISORY: Auto-checkpoint would fire (blast radius ${uniqueCount} files) but auto_commit_enabled=false.`);
    return;
  }

  try {
    // Stage tracked files for the stash snapshot (exclude DB files)
    for (const f of uniqueFiles) {
      if (fs.existsSync(f) && !f.endsWith('.db') && !f.endsWith('.db-journal') && !f.endsWith('.db-wal')) {
        try {
          execFileSync('git', ['add', f], { stdio: 'pipe' });
        } catch (e) {
          logger.debug('Failed to git add file', { error: errorMessage(e), file: f });
        }
      }
    }

    // Create stash snapshot without touching HEAD
    const sha = execSync('git stash create', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    // Unstage so working tree stays dirty
    execSync('git reset HEAD', { stdio: 'pipe' });

    if (!sha) {
      out(`${PREFIX} git stash create returned empty — no snapshot needed.`);
      return;
    }

    // Protect SHA from garbage collection
    const stashMsg = `AgentSentry auto-checkpoint — blast radius ${uniqueCount} files`;
    execFileSync('git', ['stash', 'store', '-m', stashMsg, sha], { stdio: 'pipe' });

    out(`${PREFIX} Stash snapshot created: ${sha} (${uniqueCount} files)`);
  } catch (e) {
    logger.debug('Stash snapshot failed during blast-radius checkpoint', { error: errorMessage(e) });
  }
}

async function main(): Promise<void> {
  if (!isGloballyEnabled()) {
    return;
  }

  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let input: HookInput;
  try {
    input = safeJsonParse<HookInput>(raw);
  } catch (e) {
    logger.warn('Failed to parse hook input from stdin', { error: errorMessage(e) });
    process.exit(0);
  }

  const filePath = input.tool_input?.file_path ?? input.input?.file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    process.exit(0);
  }

  const content = safeReadSync(filePath).toString('utf-8');

  // 1. Error Handling Enforcer
  const errorFindings = scanErrorHandling(content, filePath);
  for (const f of errorFindings) {
    out(`${PREFIX} WARN: Unhandled call in ${filePath}:${f.line}. Type: ${f.callType}`);
    out(`${PREFIX} RECOMMEND: Add error handling with graceful fallback.`);
  }

  // 2. PII Logging Scanner
  const piiFindings = scanPiiLogging(content, filePath);
  for (const f of piiFindings) {
    out(`${PREFIX} WARN: PII in logging: ${f.field} in ${filePath}:${f.line}`);
  }

  // 3. Blast Radius Tracking
  checkBlastRadius(filePath);
}

if (require.main === module) {
  main().catch(() => {}).finally(() => process.exit(0));
}
