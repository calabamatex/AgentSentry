import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { healthCommand } from '../../src/cli/commands/health';
import type { ParsedArgs } from '../../src/cli/parser';

describe('CLI health command', () => {
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
    return { command: 'health', positionals, flags };
  }

  it('has correct name and description', () => {
    expect(healthCommand.name).toBe('health');
    expect(healthCommand.description).toBeTruthy();
  });

  it('runs liveness check', async () => {
    await healthCommand.run(args(['live']));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('Status: ok');
  });

  it('runs liveness check with --json', async () => {
    await healthCommand.run(args(['live'], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe('ok');
    expect(typeof parsed.uptime).toBe('number');
  });

  it('runs readiness check by default', async () => {
    await healthCommand.run(args([]));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    // Should contain a status indicator
    expect(out).toMatch(/HEALTHY|DEGRADED|UNHEALTHY/);
  });

  it('runs readiness check with --json', async () => {
    await healthCommand.run(args(['ready'], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(parsed.status).toMatch(/healthy|degraded|unhealthy/);
    expect(parsed.checks).toBeDefined();
    expect(typeof parsed.uptime).toBe('number');
  });

  it('errors on unknown subcommand', async () => {
    await healthCommand.run(args(['bogus']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Unknown health subcommand');
  });
});
