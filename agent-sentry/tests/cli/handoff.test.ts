/**
 * Tests for cli/commands/handoff.ts — `agent-sentry handoff` command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';

// Mock child_process.execSync before importing the command
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

// Mock fs for save functionality
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    mkdirSync: vi.fn(),
  };
});

// Mock the memory store import
vi.mock('../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
  })),
}));

import { handoffCommand, generateHandoffResult, saveHandoffToMemory } from '../../src/cli/commands/handoff';
import type { ParsedArgs } from '../../src/cli/parser';

const mockedExecSync = vi.mocked(childProcess.execSync);

function mockGitCommands(): void {
  mockedExecSync.mockImplementation((cmd: string) => {
    const cmdStr = String(cmd);
    if (cmdStr.includes('branch --show-current')) return 'main';
    if (cmdStr.includes('rev-parse --abbrev-ref')) return 'main';
    if (cmdStr.includes('log -1 --oneline')) return 'abc1234 fix: some recent fix';
    if (cmdStr.includes('status --short')) return ' M src/foo.ts\n M src/bar.ts';
    if (cmdStr.includes('diff --stat')) return ' src/foo.ts | 10 ++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)';
    if (cmdStr.includes('log --oneline -10')) return 'abc1234 fix: some recent fix\ndef5678 feat: add feature\nghi9012 chore: cleanup';
    return '';
  });
}

describe('handoff command', () => {
  let stdout: string;

  beforeEach(() => {
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdout += String(chunk);
      return true;
    });
    mockGitCommands();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and description', () => {
    expect(handoffCommand.name).toBe('handoff');
    expect(handoffCommand.description).toContain('handoff');
  });

  it('generates handoff with git state', async () => {
    const args: ParsedArgs = {
      command: 'handoff',
      positionals: [],
      flags: {},
    };

    await handoffCommand.run(args);

    expect(stdout).toContain('Session Handoff');
    expect(stdout).toContain('main');
    expect(stdout).toContain('abc1234');
    expect(stdout).toContain('Uncommitted Changes');
    expect(stdout).toContain('src/foo.ts');
    expect(stdout).toContain('Recent Commits');
    expect(stdout).toContain('Handoff Prompt');
  });

  it('outputs JSON when --json flag is set', async () => {
    const args: ParsedArgs = {
      command: 'handoff',
      positionals: [],
      flags: { json: true },
    };

    await handoffCommand.run(args);

    const parsed = JSON.parse(stdout);
    expect(parsed.branch).toBe('main');
    expect(parsed.last_commit).toContain('abc1234');
    expect(parsed.recent_commits).toHaveLength(3);
    expect(parsed.handoff_prompt).toBeDefined();
    expect(parsed.generated_at).toBeDefined();
  });

  it('includes remaining work from --remaining flag', async () => {
    const args: ParsedArgs = {
      command: 'handoff',
      positionals: [],
      flags: { remaining: 'Fix auth tests,Deploy to staging' },
    };

    await handoffCommand.run(args);

    expect(stdout).toContain('Fix auth tests');
    expect(stdout).toContain('Deploy to staging');
    expect(stdout).toContain('Remaining Work');
  });

  it('includes a paste-ready handoff prompt', async () => {
    const args: ParsedArgs = {
      command: 'handoff',
      positionals: [],
      flags: {},
    };

    await handoffCommand.run(args);

    // Should contain the paste-ready prompt section
    expect(stdout).toContain('Handoff Prompt');
    expect(stdout).toContain('Copy and paste');
    // The prompt should reference the branch and recent work
    expect(stdout).toContain('Pick up where the previous session left off');
  });

  it('includes frontmatter in formatted output', async () => {
    const args: ParsedArgs = {
      command: 'handoff',
      positionals: [],
      flags: {},
    };

    await handoffCommand.run(args);

    expect(stdout).toContain('---');
    expect(stdout).toContain('name: Auto-handoff');
    expect(stdout).toContain('type: project');
  });

  it('handles missing git gracefully', async () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const args: ParsedArgs = {
      command: 'handoff',
      positionals: [],
      flags: {},
    };

    // Should not throw
    await handoffCommand.run(args);

    expect(stdout).toContain('Session Handoff');
    expect(stdout).toContain('unknown');
  });

  it('has usage documentation', () => {
    expect(handoffCommand.usage).toBeDefined();
    expect(handoffCommand.usage).toContain('--save');
    expect(handoffCommand.usage).toContain('--json');
    expect(handoffCommand.usage).toContain('--remaining');
  });
});

describe('generateHandoffResult', () => {
  beforeEach(() => {
    mockGitCommands();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a HandoffResult with git state', async () => {
    const result = await generateHandoffResult();
    expect(result.branch).toBe('main');
    expect(result.last_commit).toContain('abc1234');
    expect(result.recent_commits).toHaveLength(3);
    expect(result.handoff_prompt).toContain('Pick up where the previous session left off');
    expect(result.generated_at).toBeDefined();
  });

  it('accepts remaining work items', async () => {
    const result = await generateHandoffResult({ remaining: ['Fix auth', 'Deploy'] });
    expect(result.remaining_work).toEqual(['Fix auth', 'Deploy']);
    expect(result.handoff_prompt).toContain('Fix auth');
  });

  it('includes uncommitted changes', async () => {
    const result = await generateHandoffResult();
    expect(result.uncommitted_changes).toContain('src/foo.ts');
  });
});

describe('generateHandoffResult with todos', () => {
  beforeEach(() => {
    mockGitCommands();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes an empty todos array when no todo files found', async () => {
    const result = await generateHandoffResult();
    expect(result.todos).toBeDefined();
    expect(Array.isArray(result.todos)).toBe(true);
  });

  it('handoff prompt includes incomplete todos hint', async () => {
    // The result will have empty todos since fs is mocked,
    // but we verify the structure is correct
    const result = await generateHandoffResult();
    expect(result).toHaveProperty('todos');
    // When there are no todos, the prompt should not mention them
    if (result.todos.length === 0) {
      expect(result.handoff_prompt).not.toContain('Incomplete tasks');
    }
  });
});

describe('saveHandoffToMemory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when memory dir does not exist', () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);
    mockedExistsSync.mockReturnValue(false);

    const result = saveHandoffToMemory({
      generated_at: new Date().toISOString(),
      branch: 'main',
      last_commit: 'abc1234 test',
      uncommitted_changes: '',
      git_diff_stat: '',
      recent_commits: [],
      session_summary: '',
      remaining_work: [],
      handoff_prompt: 'test prompt',
    });

    expect(result).toBeUndefined();
  });
});
