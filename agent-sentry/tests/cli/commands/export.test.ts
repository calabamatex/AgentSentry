/**
 * Tests for src/cli/commands/export.ts
 *
 * We test the exportCommand.run() by mocking the MemoryStore and
 * capturing stdout/stderr writes and fs.writeFileSync calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock MemoryStore before importing the module
const mockList = vi.fn();
const mockClose = vi.fn();
const mockInitialize = vi.fn();

vi.mock('../../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    list: mockList,
    close: mockClose,
  })),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

vi.mock('../../../src/utils/safe-io', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/safe-io')>('../../../src/utils/safe-io');
  return {
    ...actual,
    atomicWriteSync: vi.fn(),
  };
});

import * as fs from 'fs';
import { atomicWriteSync } from '../../../src/utils/safe-io';
import { exportCommand } from '../../../src/cli/commands/export';
import type { ParsedArgs } from '../../../src/cli/parser';

describe('exportCommand', () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let originalExitCode: number | undefined;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    mockList.mockReset();
    mockClose.mockReset();
    mockInitialize.mockReset();
    mockList.mockResolvedValue([]);
    mockClose.mockResolvedValue(undefined);
    mockInitialize.mockResolvedValue(undefined);
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function makeArgs(flags: Record<string, string | boolean> = {}): ParsedArgs {
    return { command: 'export', positionals: [], flags };
  }

  // ---- metadata ----

  it('has correct name and description', () => {
    expect(exportCommand.name).toBe('export');
    expect(exportCommand.description).toBeTruthy();
  });

  it('has usage text', () => {
    expect(exportCommand.usage).toContain('--format');
  });

  // ---- format validation ----

  it('rejects unknown format', async () => {
    await exportCommand.run(makeArgs({ format: 'csv' }));
    expect(stderrChunks.join('')).toContain('Unknown format: csv');
    expect(process.exitCode).toBe(1);
  });

  // ---- JSON export (default) ----

  it('exports empty array as JSON to stdout by default', async () => {
    mockList.mockResolvedValue([]);

    await exportCommand.run(makeArgs());

    const out = stdoutChunks.join('');
    expect(JSON.parse(out)).toEqual([]);
    expect(stderrChunks.join('')).toContain('Exported 0 event(s) as json to stdout');
  });

  it('exports events as JSON', async () => {
    const events = [{ id: '1', title: 'test' }, { id: '2', title: 'test2' }];
    mockList.mockResolvedValue(events);

    await exportCommand.run(makeArgs({ format: 'json' }));

    const out = stdoutChunks.join('');
    expect(JSON.parse(out)).toEqual(events);
    expect(stderrChunks.join('')).toContain('Exported 2 event(s) as json');
  });

  // ---- NDJSON export ----

  it('exports events as NDJSON', async () => {
    const events = [{ id: '1' }, { id: '2' }];
    mockList.mockResolvedValue(events);

    await exportCommand.run(makeArgs({ format: 'ndjson' }));

    const out = stdoutChunks.join('');
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ id: '1' });
    expect(JSON.parse(lines[1])).toEqual({ id: '2' });
  });

  it('exports empty NDJSON with no trailing newline', async () => {
    mockList.mockResolvedValue([]);

    await exportCommand.run(makeArgs({ format: 'ndjson' }));

    const out = stdoutChunks.join('');
    expect(out).toBe('');
  });

  // ---- since / until filters ----

  it('passes since and until to store.list', async () => {
    mockList.mockResolvedValue([]);

    await exportCommand.run(makeArgs({ since: '2024-01-01', until: '2024-12-31' }));

    expect(mockList).toHaveBeenCalledWith({
      since: '2024-01-01',
      until: '2024-12-31',
      limit: 100000,
    });
  });

  it('omits since/until when not provided', async () => {
    mockList.mockResolvedValue([]);

    await exportCommand.run(makeArgs());

    expect(mockList).toHaveBeenCalledWith({
      since: undefined,
      until: undefined,
      limit: 100000,
    });
  });

  // ---- output to file ----

  it('writes to file when --output is specified', async () => {
    const events = [{ id: '1' }];
    mockList.mockResolvedValue(events);

    await exportCommand.run(makeArgs({ output: '/tmp/export-test.json' }));

    const mockAtomicWrite = atomicWriteSync as ReturnType<typeof vi.fn>;
    expect(mockAtomicWrite).toHaveBeenCalled();
    const writtenPath = mockAtomicWrite.mock.calls[0][0];
    const written = mockAtomicWrite.mock.calls[0][1];
    expect(writtenPath).toContain('export-test.json');
    expect(JSON.parse(written)).toEqual(events);
    expect(stderrChunks.join('')).toContain('Exported 1 event(s) as json to /tmp/export-test.json');
  });

  // ---- store lifecycle ----

  it('always closes the store, even on error', async () => {
    mockList.mockRejectedValue(new Error('db fail'));

    await expect(exportCommand.run(makeArgs())).rejects.toThrow('db fail');
    expect(mockClose).toHaveBeenCalled();
  });

  // ---- boolean flags treated as non-string ----

  it('ignores boolean since/until flags', async () => {
    mockList.mockResolvedValue([]);

    await exportCommand.run(makeArgs({ since: true, until: true }));

    expect(mockList).toHaveBeenCalledWith({
      since: undefined,
      until: undefined,
      limit: 100000,
    });
  });
});
