/**
 * package-contents.test.ts — Validates that npm pack produces a complete artifact.
 *
 * Ensures every runtime-required file is included in the published package.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

describe('Package contents', () => {
  it('npm pack --dry-run includes all required runtime assets', () => {
    const output = execSync('npm pack --dry-run --json 2>/dev/null || npm pack --dry-run', {
      cwd: join(__dirname, '../..'),
      encoding: 'utf-8',
    });

    // Check for critical directories/files in pack output.
    // Shell wrappers in scripts/ delegate to compiled TS hooks in dist/,
    // so both must be present for hooks to function at runtime.
    const requiredPatterns = [
      'dist/src/index.js',
      'dist/src/cli/index.js',
      'dist/src/mcp/server.js',
      'dist/src/cli/hooks/session-start.js',
      'dist/src/cli/hooks/post-write.js',
      'dist/src/cli/hooks/session-checkpoint.js',
      'dist/src/analyzers/error-handling.js',
      'dist/src/analyzers/pii-scanner.js',
      'dist/src/config/resolve.js',
      'agent-sentry.config.json',
    ];

    for (const pattern of requiredPatterns) {
      expect(output).toContain(pattern);
    }
  });

  it('required scripts exist on disk', () => {
    const scriptsDir = join(__dirname, '../../scripts');
    const requiredScripts = [
      'session-start-checks.sh',
      'post-write-checks.sh',
      'session-checkpoint.sh',
      'secret-scanner.sh',
      'permission-enforcer.sh',
      'delegation-validator.sh',
    ];

    for (const script of requiredScripts) {
      expect(existsSync(join(scriptsDir, script))).toBe(true);
    }
  });

  it('compiled TypeScript hooks exist in dist/', () => {
    const distDir = join(__dirname, '../../dist/src');
    const requiredHooks = [
      'cli/hooks/session-start.js',
      'cli/hooks/post-write.js',
      'cli/hooks/session-checkpoint.js',
      'analyzers/error-handling.js',
      'analyzers/pii-scanner.js',
    ];

    for (const hook of requiredHooks) {
      expect(existsSync(join(distDir, hook))).toBe(true);
    }
  });

  it('agent-sentry.config.json exists', () => {
    const configPath = join(__dirname, '../../agent-sentry.config.json');
    expect(existsSync(configPath)).toBe(true);
  });
});
