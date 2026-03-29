/**
 * Tests for cli/hooks/session-checkpoint.ts — auto-save handoff on session end.
 *
 * We test the auto-save logic by importing the handoff functions directly,
 * since the checkpoint hook runs as a standalone script.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';

// Mock child_process before imports
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

// Mock the memory store
vi.mock('../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    mkdirSync: vi.fn(),
  };
});

import { generateHandoffResult, saveHandoffToMemory } from '../../src/cli/commands/handoff';

const mockedExecFileSync = vi.mocked(childProcess.execFileSync);

describe('auto-save handoff (session-checkpoint integration)', () => {
  beforeEach(() => {
    mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
      const argsStr = (args ?? []).join(' ');
      if (argsStr.includes('branch --show-current')) return 'main';
      if (argsStr.includes('rev-parse --abbrev-ref')) return 'main';
      if (argsStr.includes('log -1 --oneline')) return 'abc1234 fix: test';
      if (argsStr.includes('status --short')) return ' M file.ts';
      if (argsStr.includes('diff --stat')) return ' file.ts | 3 ++\n 1 file changed';
      if (argsStr.includes('log --oneline -10')) return 'abc1234 fix: test';
      return '';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateHandoffResult produces valid result for auto-save', async () => {
    const result = await generateHandoffResult();
    expect(result.branch).toBe('main');
    expect(result.handoff_prompt).toBeDefined();
    expect(result.generated_at).toBeDefined();
  });

  it('saveHandoffToMemory returns undefined when no memory dir', () => {
    const result = saveHandoffToMemory({
      generated_at: new Date().toISOString(),
      branch: 'main',
      last_commit: 'abc',
      uncommitted_changes: '',
      git_diff_stat: '',
      recent_commits: [],
      session_summary: '',
      remaining_work: [],
      handoff_prompt: 'test',
    });
    expect(result).toBeUndefined();
  });

  it('handoff result includes uncommitted changes for auto-save context', async () => {
    const result = await generateHandoffResult();
    expect(result.uncommitted_changes).toContain('file.ts');
  });
});
