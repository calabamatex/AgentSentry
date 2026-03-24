import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memoryCommand } from '../../src/cli/commands/memory';
import type { ParsedArgs } from '../../src/cli/parser';

// Mock the MemoryStore to avoid requiring SQLite in tests
vi.mock('../../src/memory/store', () => {
  const mockStore = {
    initialize: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([
      {
        event: {
          id: 'abc12345-6789',
          event_type: 'tool_use',
          severity: 'info',
          title: 'Test event title',
          timestamp: '2026-03-21T10:00:00Z',
        },
        score: 0.95,
      },
    ]),
    list: vi.fn().mockResolvedValue([
      {
        id: 'def12345-6789',
        event_type: 'session_start',
        severity: 'info',
        title: 'Session started',
        timestamp: '2026-03-21T09:00:00Z',
      },
    ]),
    stats: vi.fn().mockResolvedValue({
      total_events: 42,
      by_type: { tool_use: 20, session_start: 10, session_end: 12 },
      by_severity: { info: 30, warning: 10, error: 2 },
      by_skill: { memory: 15, primitives: 27 },
      first_event: '2026-03-01T00:00:00Z',
      last_event: '2026-03-21T12:00:00Z',
    }),
    verifyChain: vi.fn().mockResolvedValue({
      valid: true,
      total_checked: 42,
    }),
  };

  return {
    MemoryStore: vi.fn(() => mockStore),
    __mockStore: mockStore,
  };
});

describe('CLI memory command', () => {
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
    return { command: 'memory', positionals, flags };
  }

  it('has correct name and description', () => {
    expect(memoryCommand.name).toBe('memory');
    expect(memoryCommand.description).toBeTruthy();
  });

  it('errors when no subcommand given', async () => {
    await memoryCommand.run(args([]));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  it('errors on search without query', async () => {
    await memoryCommand.run(args(['search']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Usage');
  });

  describe('search', () => {
    it('outputs table for search results', async () => {
      await memoryCommand.run(args(['search', 'auth', 'patterns']));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      expect(out).toContain('0.950');
      expect(out).toContain('tool_use');
    });

    it('outputs JSON for search with --json', async () => {
      await memoryCommand.run(args(['search', 'auth'], { json: true }));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(out);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].score).toBe(0.95);
    });
  });

  describe('list', () => {
    it('outputs table for events', async () => {
      await memoryCommand.run(args(['list']));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      expect(out).toContain('session_start');
      expect(out).toContain('Session started');
    });

    it('outputs JSON for list with --json', async () => {
      await memoryCommand.run(args(['list'], { json: true }));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(out);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe('stats', () => {
    it('outputs formatted stats', async () => {
      await memoryCommand.run(args(['stats']));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      expect(out).toContain('Total events: 42');
      expect(out).toContain('tool_use=20');
      expect(out).toContain('Oldest:');
      expect(out).toContain('Newest:');
    });

    it('outputs JSON stats with --json', async () => {
      await memoryCommand.run(args(['stats'], { json: true }));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(out);
      expect(parsed.total_events).toBe(42);
    });
  });

  describe('verify', () => {
    it('outputs chain status', async () => {
      await memoryCommand.run(args(['verify']));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      expect(out).toContain('valid');
      expect(out).toContain('42 checked');
    });

    it('outputs JSON chain status with --json', async () => {
      await memoryCommand.run(args(['verify'], { json: true }));
      const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(out);
      expect(parsed.valid).toBe(true);
      expect(parsed.total_checked).toBe(42);
    });
  });

  it('errors on unknown subcommand', async () => {
    await memoryCommand.run(args(['bogus']));
    const err = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(err).toContain('Unknown memory subcommand');
  });
});
