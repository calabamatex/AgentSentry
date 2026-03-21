/**
 * Tests for cli/commands/enable.ts — enablement CLI command.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { enableCommand } from '../../src/cli/commands/enable';
import type { ParsedArgs } from '../../src/cli/parser';

const CONFIG_PATH = path.resolve('agentops/agentops.config.json');
let originalConfig: string | null = null;

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
    // Save original config if it exists
    try {
      originalConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
    } catch {
      originalConfig = null;
    }
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    // Restore original config
    if (originalConfig !== null) {
      fs.writeFileSync(CONFIG_PATH, originalConfig, 'utf8');
    } else {
      try {
        // Read the current config to see if enablement was added, and clean it up
        const current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        if (current.enablement) {
          delete current.enablement;
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + '\n', 'utf8');
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
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
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    expect(config.enablement.level).toBe(2);
  });

  it('has correct name and description', () => {
    expect(enableCommand.name).toBe('enable');
    expect(enableCommand.description).toBeTruthy();
    expect(enableCommand.usage).toBeTruthy();
  });
});
