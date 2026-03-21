import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configCommand } from '../../src/cli/commands/config';
import type { ParsedArgs } from '../../src/cli/parser';
import * as fs from 'fs';
import * as path from 'path';

describe('CLI config command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function args(positionals: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs {
    return { command: 'config', positionals, flags };
  }

  it('has correct name and description', () => {
    expect(configCommand.name).toBe('config');
    expect(configCommand.description).toBeTruthy();
  });

  it('shows config (default subcommand)', async () => {
    await configCommand.run(args([]));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    // Should show config table with memory.* keys
    expect(out).toContain('memory.');
  });

  it('shows config with --json', async () => {
    await configCommand.run(args(['show'], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(typeof parsed).toBe('object');
  });

  it('shows config path', async () => {
    await configCommand.run(args(['path']));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('agentops.config.json');
  });

  it('shows config path as JSON', async () => {
    await configCommand.run(args(['path'], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(parsed.path).toContain('agentops.config.json');
  });

  it('errors on missing get key', async () => {
    await configCommand.run(args(['get']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('errors on missing set key/value', async () => {
    await configCommand.run(args(['set']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('errors on unknown subcommand', async () => {
    await configCommand.run(args(['bogus']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Unknown config subcommand');
  });
});
