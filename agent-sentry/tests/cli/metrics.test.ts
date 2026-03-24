import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { metricsCommand } from '../../src/cli/commands/metrics';
import { MetricsCollector } from '../../src/observability/metrics';
import type { ParsedArgs } from '../../src/cli/parser';

describe('CLI metrics command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    MetricsCollector.reset();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    MetricsCollector.reset();
  });

  function args(positionals: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs {
    return { command: 'metrics', positionals, flags };
  }

  it('shows "No metrics" when collector is empty', async () => {
    await metricsCommand.run(args([]));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('No metrics collected');
  });

  it('shows Prometheus text when metrics exist', async () => {
    const c = MetricsCollector.getInstance();
    c.counter('test_total', 'A test counter');
    c.increment('test_total', 5);

    await metricsCommand.run(args(['show']));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('test_total');
    expect(out).toContain('5');
  });

  it('outputs JSON wrapper with --json', async () => {
    const c = MetricsCollector.getInstance();
    c.counter('req_count', 'Requests');
    c.increment('req_count', 10);

    await metricsCommand.run(args(['show'], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(parsed.format).toBe('prometheus');
    expect(parsed.text).toContain('req_count');
  });

  it('resets metrics', async () => {
    const c = MetricsCollector.getInstance();
    c.counter('x', 'Test');
    c.increment('x', 1);

    await metricsCommand.run(args(['reset']));
    // After reset, a new getInstance should have empty metrics
    const fresh = MetricsCollector.getInstance();
    expect(fresh.toPrometheus().trim()).toBe('');
  });

  it('reset outputs JSON when --json', async () => {
    await metricsCommand.run(args(['reset'], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(JSON.parse(out)).toEqual({ reset: true });
  });
});
