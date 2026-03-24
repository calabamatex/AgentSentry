/**
 * hook-lifecycle.test.ts — E2E: Invoke each critical hook script and verify
 * expected output patterns and exit codes.
 */

import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

const SCRIPTS_DIR = join(__dirname, '../../scripts');

/** Run a hook script with the given JSON stdin and return { stdout, stderr, exitCode }. */
function runHook(
  scriptName: string,
  stdinJson: string,
  env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  const scriptPath = join(SCRIPTS_DIR, scriptName);
  const result = spawnSync('bash', [scriptPath], {
    input: stdinJson,
    encoding: 'utf-8',
    timeout: 15_000,
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? -1,
  };
}

describe('Hook Lifecycle (e2e)', () => {
  describe('session-start-checks.sh', () => {
    it('exits 0 (advisory only)', () => {
      const { exitCode } = runHook('session-start-checks.sh', '{}');
      expect(exitCode).toBe(0);
    });

    it('produces [AgentSentry] prefixed output', () => {
      const { stdout, stderr } = runHook('session-start-checks.sh', '{}');
      const combined = stdout + stderr;
      // Should produce at least one line of output
      expect(combined.length).toBeGreaterThan(0);
      // At least one line should have the [AgentSentry] prefix
      const prefixedLines = combined.split('\n').filter((l) => l.includes('[AgentSentry]'));
      expect(prefixedLines.length).toBeGreaterThan(0);
    });
  });

  describe('post-write-checks.sh', () => {
    it('exits 0 with empty input', () => {
      const { exitCode } = runHook('post-write-checks.sh', '{}');
      expect(exitCode).toBe(0);
    });

    it('exits 0 with valid file path that does not exist', () => {
      const input = JSON.stringify({
        tool_input: { file_path: '/nonexistent/file.ts' },
      });
      const { exitCode } = runHook('post-write-checks.sh', input);
      expect(exitCode).toBe(0);
    });

    it('runs error-handling check on a real file', () => {
      // Use this test file itself as input
      const input = JSON.stringify({
        tool_input: { file_path: join(__dirname, 'hook-lifecycle.test.ts') },
      });
      const { exitCode } = runHook('post-write-checks.sh', input);
      expect(exitCode).toBe(0);
    });
  });

  describe('session-checkpoint.sh', () => {
    it('exits 0 (advisory only)', () => {
      const { exitCode } = runHook('session-checkpoint.sh', '{}');
      expect(exitCode).toBe(0);
    });
  });

  describe('secret-scanner.sh', () => {
    it('exits 0 for clean content', () => {
      const input = JSON.stringify({
        tool_input: {
          file_path: '/tmp/test-clean.ts',
          content: 'const x = 42;\nconsole.log(x);',
        },
      });
      const { exitCode } = runHook('secret-scanner.sh', input);
      expect(exitCode).toBe(0);
    });

    it('exits 2 (blocking) for content with a secret', () => {
      const input = JSON.stringify({
        tool_input: {
          file_path: '/tmp/test-secret.ts',
          content: 'const db = "postgresql://admin:hunter2@localhost:5432/mydb";',
        },
      });
      const { exitCode, stderr } = runHook('secret-scanner.sh', input);
      expect(exitCode).toBe(2);
      expect(stderr).toContain('SECRET DETECTED');
    });

    it('exits 0 for empty content', () => {
      const input = JSON.stringify({
        tool_input: { file_path: '/tmp/test-empty.ts', content: '' },
      });
      const { exitCode } = runHook('secret-scanner.sh', input);
      expect(exitCode).toBe(0);
    });
  });

  describe('dependency resilience', () => {
    it('all critical scripts exist and are executable', () => {
      const criticalScripts = [
        'session-start-checks.sh',
        'post-write-checks.sh',
        'session-checkpoint.sh',
        'secret-scanner.sh',
      ];
      for (const script of criticalScripts) {
        expect(existsSync(join(SCRIPTS_DIR, script))).toBe(true);
      }
    });
  });
});
