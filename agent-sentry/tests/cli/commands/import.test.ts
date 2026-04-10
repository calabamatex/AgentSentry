/**
 * Tests for src/cli/commands/import.ts
 *
 * We mock MemoryStore and fs to test the import command logic including
 * JSON/NDJSON parsing, validation, and error reporting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock MemoryStore
const mockCapture = vi.fn();
const mockClose = vi.fn();
const mockInitialize = vi.fn();

vi.mock('../../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    capture: mockCapture,
    close: mockClose,
  })),
}));

// Mock fs
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  };
});

import { importCommand } from '../../../src/cli/commands/import';
import type { ParsedArgs } from '../../../src/cli/parser';

// A valid OpsEventInput for testing
function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'save_points',
    title: 'Test event',
    detail: 'Some detail',
    affected_files: [],
    tags: [],
    metadata: {},
    ...overrides,
  };
}

describe('importCommand', () => {
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

    mockCapture.mockReset();
    mockClose.mockReset();
    mockInitialize.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();

    mockCapture.mockResolvedValue({ id: 'new-id' });
    mockClose.mockResolvedValue(undefined);
    mockInitialize.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function makeArgs(positionals: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs {
    return { command: 'import', positionals, flags };
  }

  // ---- metadata ----

  it('has correct name and description', () => {
    expect(importCommand.name).toBe('import');
    expect(importCommand.description).toBeTruthy();
  });

  // ---- missing file argument ----

  it('prints usage and exits when no file is provided', async () => {
    await importCommand.run(makeArgs());
    expect(stderrChunks.join('')).toContain('Usage:');
    expect(process.exitCode).toBe(1);
  });

  // ---- unknown format ----

  it('rejects unknown format', async () => {
    await importCommand.run(makeArgs(['data.txt'], { format: 'csv' }));
    expect(stderrChunks.join('')).toContain('Unknown format: csv');
    expect(process.exitCode).toBe(1);
  });

  // ---- file not found ----

  it('errors when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await importCommand.run(makeArgs(['missing.json']));
    expect(stderrChunks.join('')).toContain('File not found');
    expect(process.exitCode).toBe(1);
  });

  // ---- JSON import (happy path) ----

  it('imports valid JSON array of events', async () => {
    const events = [validEvent(), validEvent({ title: 'Second' })];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(events));

    await importCommand.run(makeArgs(['events.json']));

    expect(mockCapture).toHaveBeenCalledTimes(2);
    const out = stdoutChunks.join('');
    expect(out).toContain('Imported: 2');
    expect(out).toContain('Skipped: 0');
  });

  // ---- JSON import with --json output ----

  it('outputs JSON when --json flag is set', async () => {
    const events = [validEvent()];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(events));

    await importCommand.run(makeArgs(['events.json'], { json: true }));

    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    expect(parsed.imported).toBe(1);
    expect(parsed.skipped).toBe(0);
    expect(parsed.errors).toEqual([]);
  });

  // ---- JSON must be an array ----

  it('fails when JSON input is not an array', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ not: 'array' }));

    await expect(importCommand.run(makeArgs(['events.json']))).rejects.toThrow(
      'JSON input must be an array',
    );
  });

  // ---- NDJSON import ----

  it('imports valid NDJSON', async () => {
    const lines = [JSON.stringify(validEvent()), JSON.stringify(validEvent({ title: 'B' }))].join('\n');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(lines);

    await importCommand.run(makeArgs(['events.ndjson'], { format: 'ndjson' }));

    expect(mockCapture).toHaveBeenCalledTimes(2);
    const out = stdoutChunks.join('');
    expect(out).toContain('Imported: 2');
  });

  it('skips blank lines in NDJSON', async () => {
    const lines = [JSON.stringify(validEvent()), '', '  ', JSON.stringify(validEvent({ title: 'B' }))].join('\n');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(lines);

    await importCommand.run(makeArgs(['events.ndjson'], { format: 'ndjson' }));

    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('throws on invalid JSON line in NDJSON', async () => {
    const lines = [JSON.stringify(validEvent()), 'not json'].join('\n');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(lines);

    await expect(
      importCommand.run(makeArgs(['events.ndjson'], { format: 'ndjson' })),
    ).rejects.toThrow('Invalid JSON on line 2');
  });

  // ---- validation errors ----

  it('skips events that fail validation and reports warnings', async () => {
    const events = [
      validEvent(),
      { bad: true }, // missing required fields
    ];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(events));

    await importCommand.run(makeArgs(['events.json']));

    expect(mockCapture).toHaveBeenCalledTimes(1);
    const out = stdoutChunks.join('');
    expect(out).toContain('Imported: 1');
    expect(out).toContain('Skipped: 1');
    expect(stderrChunks.join('')).toContain('Warning:');
  });

  // ---- capture errors ----

  it('skips events when store.capture throws', async () => {
    const events = [validEvent(), validEvent({ title: 'Second' })];
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(events));
    mockCapture.mockResolvedValueOnce({ id: '1' });
    mockCapture.mockRejectedValueOnce(new Error('duplicate'));

    await importCommand.run(makeArgs(['events.json']));

    const out = stdoutChunks.join('');
    expect(out).toContain('Imported: 1');
    expect(out).toContain('Skipped: 1');
  });

  // ---- store is always closed ----

  it('closes the store even when parsing fails', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json');

    await expect(importCommand.run(makeArgs(['events.json']))).rejects.toThrow();
    expect(mockClose).toHaveBeenCalled();
  });
});
