/**
 * Tests for src/cli/commands/prune.ts
 *
 * We mock MemoryStore to test dry-run vs actual prune, flag parsing,
 * and JSON vs text output modes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrune = vi.fn();
const mockStats = vi.fn();
const mockClose = vi.fn();
const mockInitialize = vi.fn();

vi.mock('../../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    prune: mockPrune,
    stats: mockStats,
    close: mockClose,
  })),
}));

import { pruneCommand } from '../../../src/cli/commands/prune';
import type { ParsedArgs } from '../../../src/cli/parser';

describe('pruneCommand', () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    mockPrune.mockReset();
    mockStats.mockReset();
    mockClose.mockReset();
    mockInitialize.mockReset();

    mockPrune.mockResolvedValue({ deleted: 0 });
    mockStats.mockResolvedValue({ total_events: 0 });
    mockClose.mockResolvedValue(undefined);
    mockInitialize.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function makeArgs(flags: Record<string, string | boolean> = {}): ParsedArgs {
    return { command: 'prune', positionals: [], flags };
  }

  // ---- metadata ----

  it('has correct name and description', () => {
    expect(pruneCommand.name).toBe('prune');
    expect(pruneCommand.description).toBeTruthy();
  });

  // ---- actual prune (no dry-run) ----

  it('calls store.prune and prints text result', async () => {
    mockPrune.mockResolvedValue({ deleted: 5 });

    await pruneCommand.run(makeArgs());

    expect(mockPrune).toHaveBeenCalledWith({
      maxEvents: undefined,
      maxAgeDays: undefined,
    });
    const out = stdoutChunks.join('');
    expect(out).toContain('Pruned 5 event(s)');
  });

  it('calls store.prune with custom limits', async () => {
    mockPrune.mockResolvedValue({ deleted: 10 });

    await pruneCommand.run(makeArgs({ 'max-events': '5000', 'max-age-days': '30' }));

    expect(mockPrune).toHaveBeenCalledWith({
      maxEvents: 5000,
      maxAgeDays: 30,
    });
  });

  it('outputs JSON when --json is set', async () => {
    mockPrune.mockResolvedValue({ deleted: 3 });

    await pruneCommand.run(makeArgs({ json: true }));

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    expect(parsed.deleted).toBe(3);
  });

  // ---- dry-run ----

  it('does not delete in dry-run mode', async () => {
    mockStats.mockResolvedValue({ total_events: 150 });

    await pruneCommand.run(makeArgs({ 'dry-run': true, 'max-events': '100' }));

    expect(mockPrune).not.toHaveBeenCalled();
    const out = stdoutChunks.join('');
    expect(out).toContain('Dry run');
    expect(out).toContain('Total events: 150');
    expect(out).toContain('Events over limit: 50');
  });

  it('shows zero over limit when under max', async () => {
    mockStats.mockResolvedValue({ total_events: 50 });

    await pruneCommand.run(makeArgs({ 'dry-run': true, 'max-events': '100' }));

    const out = stdoutChunks.join('');
    expect(out).toContain('Events over limit: 0');
  });

  it('dry-run uses default max-events (100000) when not specified', async () => {
    mockStats.mockResolvedValue({ total_events: 10 });

    await pruneCommand.run(makeArgs({ 'dry-run': true }));

    const out = stdoutChunks.join('');
    expect(out).toContain('Max events limit: 100000');
    expect(out).toContain('Max age: 365 days');
  });

  it('dry-run outputs JSON when --json is set', async () => {
    mockStats.mockResolvedValue({ total_events: 200 });

    await pruneCommand.run(makeArgs({ 'dry-run': true, 'max-events': '100', json: true }));

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    expect(parsed.total_events).toBe(200);
    expect(parsed.would_delete_over_limit).toBe(100);
    expect(parsed.max_events).toBe(100);
  });

  // ---- store lifecycle ----

  it('always closes the store', async () => {
    mockPrune.mockRejectedValue(new Error('fail'));

    await expect(pruneCommand.run(makeArgs())).rejects.toThrow('fail');
    expect(mockClose).toHaveBeenCalled();
  });
});
