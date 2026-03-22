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
 * All output prefixed with [AgentOps]. Always exits 0.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { scanErrorHandling } from '../../analyzers/error-handling';
import { scanPiiLogging } from '../../analyzers/pii-scanner';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'hook-post-write' });

const PREFIX = '[AgentOps]';

interface HookInput {
  tool_input?: { file_path?: string };
  input?: { file_path?: string };
}

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

function checkBlastRadius(filePath: string): void {
  const tmpBase = path.join(process.env.TMPDIR ?? '/tmp', 'agentops');
  const trackingFile = path.join(tmpBase, 'blast-radius-files');

  fs.mkdirSync(tmpBase, { recursive: true });

  // Append the modified file
  fs.appendFileSync(trackingFile, filePath + '\n');

  // Count unique files
  let lines: string[];
  try {
    lines = fs.readFileSync(trackingFile, 'utf-8').split('\n').filter(Boolean);
  } catch (e) {
    logger.debug('Failed to read blast-radius tracking file', { error: e instanceof Error ? e.message : String(e) });
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
      const sessionStart = fs.readFileSync(sessionMarker, 'utf-8').trim();
      const recentCommits = execSync(`git log --after="${sessionStart}" --oneline`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (recentCommits) needsCheckpoint = false;
    } catch (e) {
      logger.debug('Git log check failed, git may not be available', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!needsCheckpoint) return;

  console.log(`${PREFIX} WARN: ${uniqueCount} files modified without a checkpoint. Auto-saving.`);

  // Attempt auto-commit
  let anyAdded = false;
  for (const f of uniqueFiles) {
    if (fs.existsSync(f)) {
      try {
        if (f.endsWith('.db') || f.endsWith('.db-journal') || f.endsWith('.db-wal')) {
          continue;
        }
        execSync(`git add "${f}"`, { stdio: 'pipe' });
        anyAdded = true;
      } catch (e) {
        logger.debug('Failed to git add file', { error: e instanceof Error ? e.message : String(e), file: f });
      }
    }
  }

  if (!anyAdded) return;

  const config = readConfig();
  const autoEnabled = config?.save_points?.auto_commit_enabled ?? true;

  if (!autoEnabled) {
    try {
      execSync('git reset HEAD', { stdio: 'pipe' });
    } catch (e) {
      logger.debug('Failed to reset staged files', { error: e instanceof Error ? e.message : String(e) });
    }
    console.log(`${PREFIX} ADVISORY: Auto-checkpoint would fire (blast radius ${uniqueCount} files) but auto_commit_enabled=false.`);
  } else {
    try {
      execSync(`git commit -m "chore(agentops): auto-checkpoint — blast radius ${uniqueCount} files"`, { stdio: 'pipe' });
      console.log(`${PREFIX} Auto-checkpoint commit created.`);
    } catch (e) {
      logger.debug('Auto-checkpoint commit failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

async function main(): Promise<void> {
  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    logger.warn('Failed to parse hook input from stdin', { error: e instanceof Error ? e.message : String(e) });
    process.exit(0);
  }

  const filePath = input.tool_input?.file_path ?? input.input?.file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    process.exit(0);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  // 1. Error Handling Enforcer
  const errorFindings = scanErrorHandling(content, filePath);
  for (const f of errorFindings) {
    console.log(`${PREFIX} WARN: Unhandled call in ${filePath}:${f.line}. Type: ${f.callType}`);
    console.log(`${PREFIX} RECOMMEND: Add error handling with graceful fallback.`);
  }

  // 2. PII Logging Scanner
  const piiFindings = scanPiiLogging(content, filePath);
  for (const f of piiFindings) {
    console.log(`${PREFIX} WARN: PII in logging: ${f.field} in ${filePath}:${f.line}`);
  }

  // 3. Blast Radius Tracking
  checkBlastRadius(filePath);
}

main().catch(() => {}).finally(() => process.exit(0));
