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

    // Check for critical directories/files in pack output
    const requiredPatterns = [
      'dist/src/index.js',
      'dist/src/cli/index.js',
      'dist/src/mcp/server.js',
      'scripts/session-start-checks.sh',
      'scripts/post-write-checks.sh',
      'scripts/session-checkpoint.sh',
      'scripts/secret-scanner.sh',
      'agentops.config.json',
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

  it('agentops.config.json exists', () => {
    const configPath = join(__dirname, '../../agentops.config.json');
    expect(existsSync(configPath)).toBe(true);
  });
});
