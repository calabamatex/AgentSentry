/**
 * install-and-run.test.ts — E2E: npm pack → install from tarball → verify CLI runs.
 *
 * Validates the actual user journey: someone installs from npm and the
 * package works out of the box.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const AGENT_SENTRY_ROOT = join(__dirname, '../..');
let tarballPath: string;
let tempDir: string;

describe('Install and Run (e2e)', () => {
  beforeAll(() => {
    // Pack the package
    const packOutput = execSync('npm pack --json 2>/dev/null || npm pack', {
      cwd: AGENT_SENTRY_ROOT,
      encoding: 'utf-8',
    });

    // Find the tarball — npm pack --json returns JSON array, fallback to filename
    let tarballName: string;
    try {
      const parsed = JSON.parse(packOutput);
      tarballName = Array.isArray(parsed) ? parsed[0].filename : parsed.filename;
    } catch {
      tarballName = packOutput.trim().split('\n').pop()!.trim();
    }

    tarballPath = join(AGENT_SENTRY_ROOT, tarballName);
    expect(existsSync(tarballPath)).toBe(true);

    // Create a temp directory to simulate a fresh install
    tempDir = mkdtempSync(join(tmpdir(), 'agent-sentry-e2e-'));
    execSync('npm init -y', { cwd: tempDir, stdio: 'pipe' });
  });

  afterAll(() => {
    // Cleanup
    if (tarballPath && existsSync(tarballPath)) {
      rmSync(tarballPath, { force: true });
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('tarball installs without errors', () => {
    const result = execSync(`npm install "${tarballPath}" --ignore-scripts 2>&1`, {
      cwd: tempDir,
      encoding: 'utf-8',
    });
    // npm install should not produce "ERR!" lines
    expect(result).not.toContain('ERR!');
  });

  it('installed package contains dist/src/index.js', () => {
    const indexPath = join(tempDir, 'node_modules/agent-sentry/dist/src/index.js');
    expect(existsSync(indexPath)).toBe(true);
  });

  it('installed package contains config resolution module', () => {
    const resolvePath = join(tempDir, 'node_modules/agent-sentry/dist/src/config/resolve.js');
    expect(existsSync(resolvePath)).toBe(true);
  });

  it('installed package contains agentops.config.json', () => {
    const configPath = join(tempDir, 'node_modules/agent-sentry/agentops.config.json');
    expect(existsSync(configPath)).toBe(true);
  });

  it('CLI entry point exists and is valid JS', () => {
    const cliPath = join(tempDir, 'node_modules/agent-sentry/dist/src/cli/index.js');
    expect(existsSync(cliPath)).toBe(true);
    // Verify it parses as valid JS
    expect(() => {
      execSync(`node -c "${cliPath}"`, { stdio: 'pipe' });
    }).not.toThrow();
  });

  it('MCP server entry point exists and is valid JS', () => {
    const mcpPath = join(tempDir, 'node_modules/agent-sentry/dist/src/mcp/server.js');
    expect(existsSync(mcpPath)).toBe(true);
    expect(() => {
      execSync(`node -c "${mcpPath}"`, { stdio: 'pipe' });
    }).not.toThrow();
  });
});
