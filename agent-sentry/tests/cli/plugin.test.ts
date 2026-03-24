import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pluginCommand } from '../../src/cli/commands/plugin';
import type { ParsedArgs } from '../../src/cli/parser';

describe('CLI plugin command', () => {
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
    return { command: 'plugin', positionals, flags };
  }

  it('has correct name and description', () => {
    expect(pluginCommand.name).toBe('plugin');
    expect(pluginCommand.description).toBeTruthy();
  });

  it('errors when no subcommand given', async () => {
    await pluginCommand.run(args([]));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('lists plugins (may be empty)', async () => {
    await pluginCommand.run(args(['list']));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    // Either shows a table or "No plugins installed"
    expect(out.length).toBeGreaterThan(0);
  });

  it('lists plugins with --json', async () => {
    await pluginCommand.run(args(['list'], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('searches plugins (may return empty)', async () => {
    await pluginCommand.run(args(['search', 'nonexistent']));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out.length).toBeGreaterThan(0);
  });

  it('errors on install without path', async () => {
    await pluginCommand.run(args(['install']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('errors on enable without name', async () => {
    await pluginCommand.run(args(['enable']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('errors on disable without name', async () => {
    await pluginCommand.run(args(['disable']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('errors on info without name', async () => {
    await pluginCommand.run(args(['info']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('returns not-found for unknown plugin info', async () => {
    await pluginCommand.run(args(['info', 'does-not-exist']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('not found');
  });

  it('errors on unknown subcommand', async () => {
    await pluginCommand.run(args(['bogus']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Unknown plugin subcommand');
  });
});
