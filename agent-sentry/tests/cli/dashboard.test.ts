import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dashboardCommand } from '../../src/cli/commands/dashboard';
import type { ParsedArgs } from '../../src/cli/parser';

// Mock the DashboardServer to avoid binding ports in unit tests
vi.mock('../../src/dashboard/server', () => {
  class MockDashboardServer {
    private _port: number;
    private _host: string;

    constructor(options?: { port?: number; host?: string }) {
      this._port = options?.port ?? 9200;
      this._host = options?.host ?? '127.0.0.1';
    }

    async start() {
      return { port: this._port, host: this._host, url: `http://${this._host}:${this._port}` };
    }

    async stop() {}
    isRunning() { return true; }
  }

  return { DashboardServer: MockDashboardServer };
});

describe('CLI dashboard command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function args(positionals: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs {
    return { command: 'dashboard', positionals, flags };
  }

  it('has correct name and description', () => {
    expect(dashboardCommand.name).toBe('dashboard');
    expect(dashboardCommand.description).toBeTruthy();
  });

  it('starts the dashboard server', async () => {
    await dashboardCommand.run(args([]));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('Dashboard running at');
    expect(out).toContain('http://');
  });

  it('respects --port flag', async () => {
    await dashboardCommand.run(args([], { port: '3000' }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('3000');
  });

  it('outputs JSON with --json flag', async () => {
    await dashboardCommand.run(args([], { json: true }));
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(parsed.port).toBeDefined();
    expect(parsed.url).toBeDefined();
  });

  it('registers SIGINT handler for cleanup', async () => {
    await dashboardCommand.run(args([]));
    const sigintCalls = processOnSpy.mock.calls.filter((c) => c[0] === 'SIGINT');
    expect(sigintCalls.length).toBeGreaterThan(0);
  });
});
