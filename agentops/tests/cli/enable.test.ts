/**
 * Tests for cli/commands/enable.ts — enablement CLI command.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { enableCommand } from '../../src/cli/commands/enable';
import type { ParsedArgs } from '../../src/cli/parser';

let tmpDir: string;
let tmpConfigPath: string;

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'enable',
    positionals: [],
    flags: {},
    ...overrides,
  };
}

describe('enableCommand', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create a temp directory with its own config path to avoid contention
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-enable-test-'));
    tmpConfigPath = path.join(tmpDir, 'agentops.config.json');

    // Mock resolveConfigPath to return our temp path
    vi.mock('../../src/config/resolve', () => ({
      resolveConfigPath: () => tmpConfigPath,
    }));

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('shows current level with no flags', async () => {
    await enableCommand.run(makeArgs());
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Current level');
  });

  it('shows current level with --show', async () => {
    await enableCommand.run(makeArgs({ flags: { show: true } }));
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Current level');
  });

  it('outputs JSON with --show --json', async () => {
    await enableCommand.run(makeArgs({ flags: { show: true, json: true } }));
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('level');
    expect(parsed).toHaveProperty('active');
  });

  it('rejects invalid level', async () => {
    await enableCommand.run(makeArgs({ flags: { level: '0' } }));
    expect(process.exitCode).toBe(1);
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('must be an integer between 1 and 5');
  });

  it('rejects level 6', async () => {
    await enableCommand.run(makeArgs({ flags: { level: '6' } }));
    expect(process.exitCode).toBe(1);
  });

  it('sets level 1 successfully', async () => {
    await enableCommand.run(makeArgs({ flags: { level: '1' } }));
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Level 1');
    expect(output).toContain('Safe Ground');
    expect(output).toContain('save_points');
  });

  it('sets level 5 with all skills active', async () => {
    await enableCommand.run(makeArgs({ flags: { level: '5' } }));
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Level 5');
    expect(output).toContain('Full Guard');
    expect(output).toContain('proactive_safety');
    expect(output).toContain('maximum enablement');
  });

  it('outputs JSON when setting level with --json', async () => {
    await enableCommand.run(makeArgs({ flags: { level: '3', json: true } }));
    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe(3);
    expect(parsed.applied).toBe(true);
    expect(parsed.active).toContain('save_points');
    expect(parsed.active).toContain('context_health');
    expect(parsed.active).toContain('standing_orders');
  });

  it('persists level to config file', async () => {
    await enableCommand.run(makeArgs({ flags: { level: '2' } }));
    const config = JSON.parse(fs.readFileSync(tmpConfigPath, 'utf8'));
    expect(config.enablement.level).toBe(2);
  });

  it('has correct name and description', () => {
    expect(enableCommand.name).toBe('enable');
    expect(enableCommand.description).toBeTruthy();
    expect(enableCommand.usage).toBeTruthy();
  });
});
