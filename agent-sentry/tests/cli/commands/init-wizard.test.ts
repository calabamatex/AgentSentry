/**
 * Tests for src/cli/commands/init-wizard.ts
 *
 * Tests for pure/deterministic functions: isGitRepo, wireHooksIntoSettings,
 * appendAgentSentryRulesToClaudeMd, runHealthAudit, and AGENT_SENTRY_CLAUDE_MD_RULES.
 *
 * promptForLevel is interactive/TTY-dependent so we test it minimally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as child_process from 'child_process';

// We need to mock fs and child_process for these tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock('../../../src/utils/safe-io', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/safe-io')>('../../../src/utils/safe-io');
  return {
    ...actual,
    atomicWriteSync: vi.fn(),
    safeReadSync: vi.fn(),
  };
});

import { atomicWriteSync, safeReadSync } from '../../../src/utils/safe-io';
import {
  isGitRepo,
  wireHooksIntoSettings,
  appendAgentSentryRulesToClaudeMd,
  runHealthAudit,
  AGENT_SENTRY_CLAUDE_MD_RULES,
  type HealthSummary,
} from '../../../src/cli/commands/init-wizard';

const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = fs.writeFileSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = fs.mkdirSync as ReturnType<typeof vi.fn>;
const mockExecSync = child_process.execSync as ReturnType<typeof vi.fn>;
const mockAtomicWriteSync = atomicWriteSync as ReturnType<typeof vi.fn>;
const mockSafeReadSync = safeReadSync as unknown as ReturnType<typeof vi.fn>;

describe('isGitRepo', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns true when inside a git repo', () => {
    mockExecSync.mockReturnValue('true');
    expect(isGitRepo()).toBe(true);
  });

  it('returns false when not in a git repo', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a repo');
    });
    expect(isGitRepo()).toBe(false);
  });
});

describe('AGENT_SENTRY_CLAUDE_MD_RULES', () => {
  it('is an empty string (directive removed to prevent loops)', () => {
    expect(AGENT_SENTRY_CLAUDE_MD_RULES).toBe('');
  });
});

describe('appendAgentSentryRulesToClaudeMd', () => {
  it('always returns false (no-op)', () => {
    expect(appendAgentSentryRulesToClaudeMd('/some/path')).toBe(false);
  });
});

describe('wireHooksIntoSettings', () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockAtomicWriteSync.mockReset();
    mockSafeReadSync.mockReset();
    mockMkdirSync.mockReset();
  });

  it('creates settings file with hooks when none exists', () => {
    // .claude/settings.json does not exist, .claude dir does not exist
    mockExistsSync.mockReturnValue(false);

    const result = wireHooksIntoSettings();

    expect(result).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockAtomicWriteSync).toHaveBeenCalled();

    const written = JSON.parse(mockAtomicWriteSync.mock.calls[0][1]);
    expect(written.hooks).toBeDefined();
    expect(written.hooks.SessionStart).toBeInstanceOf(Array);
    expect(written.hooks.UserPromptSubmit).toBeInstanceOf(Array);
    expect(written.hooks.Stop).toBeInstanceOf(Array);
  });

  it('adds hooks to existing settings without hooks', () => {
    mockExistsSync.mockReturnValue(true);
    mockSafeReadSync.mockReturnValue(Buffer.from(JSON.stringify({ someKey: 'value' })));

    const result = wireHooksIntoSettings();

    expect(result).toBe(true);
    const written = JSON.parse(mockAtomicWriteSync.mock.calls[0][1]);
    expect(written.someKey).toBe('value');
    expect(written.hooks.SessionStart).toBeInstanceOf(Array);
  });

  it('does not duplicate hooks if already wired', () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ command: 'bash agent-sentry/scripts/session-start-checks.sh' }] }],
        UserPromptSubmit: [{ hooks: [{ command: 'bash agent-sentry/scripts/context-estimator.sh' }] }],
        Stop: [{ hooks: [{ command: 'bash agent-sentry/scripts/context-critical-stop.sh' }] }],
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockSafeReadSync.mockReturnValue(Buffer.from(JSON.stringify(existing)));

    const result = wireHooksIntoSettings();

    expect(result).toBe(false);
    expect(mockAtomicWriteSync).not.toHaveBeenCalled();
  });

  it('adds only missing hooks when some are already present', () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ command: 'bash agent-sentry/scripts/session-start-checks.sh' }] }],
        // UserPromptSubmit and Stop are missing
      },
    };
    mockExistsSync.mockReturnValue(true);
    mockSafeReadSync.mockReturnValue(Buffer.from(JSON.stringify(existing)));

    const result = wireHooksIntoSettings();

    expect(result).toBe(true);
    const written = JSON.parse(mockAtomicWriteSync.mock.calls[0][1]);
    // SessionStart should still have 1 entry (not duplicated)
    expect(written.hooks.SessionStart).toHaveLength(1);
    // New hooks should be added
    expect(written.hooks.UserPromptSubmit).toBeInstanceOf(Array);
    expect(written.hooks.Stop).toBeInstanceOf(Array);
  });

  it('returns false when settings file is invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockSafeReadSync.mockReturnValue(Buffer.from('not valid json'));

    const result = wireHooksIntoSettings();
    expect(result).toBe(false);
  });
});

describe('runHealthAudit', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockSafeReadSync.mockReset();
  });

  it('returns critical when not a git repo', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a repo');
    });

    const result = runHealthAudit();

    expect(result.criticals).toHaveLength(1);
    expect(result.criticals[0]).toContain('No git repository');
  });

  it('returns early on non-git repo (no warnings or advisories)', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a repo');
    });

    const result = runHealthAudit();

    expect(result.warnings).toHaveLength(0);
    expect(result.advisories).toHaveLength(0);
  });

  it('warns when CLAUDE.md is missing', () => {
    // isGitRepo succeeds, git rev-parse --show-toplevel returns a path
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--is-inside-work-tree')) return 'true';
      if (cmd.includes('--show-toplevel')) return '/repo';
      if (cmd.includes('--porcelain')) return '';
      return '';
    });
    // CLAUDE.md does not exist, scaffold docs don't exist
    mockExistsSync.mockReturnValue(false);

    const result = runHealthAudit();

    expect(result.warnings.some((w: string) => w.includes('CLAUDE.md missing'))).toBe(true);
  });

  it('advises when CLAUDE.md has no AgentSentry rules', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--is-inside-work-tree')) return 'true';
      if (cmd.includes('--show-toplevel')) return '/repo';
      if (cmd.includes('--porcelain')) return '';
      return '';
    });
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.endsWith('CLAUDE.md')) return true;
      return false;
    });
    mockSafeReadSync.mockReturnValue(Buffer.from('# My Project\n\nSome content without security or error handling.'));

    const result = runHealthAudit();

    expect(result.advisories.some((a: string) => a.includes('no AgentSentry rules'))).toBe(true);
  });

  it('warns when CLAUDE.md is missing security section', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--is-inside-work-tree')) return 'true';
      if (cmd.includes('--show-toplevel')) return '/repo';
      if (cmd.includes('--porcelain')) return '';
      return '';
    });
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.endsWith('CLAUDE.md')) return true;
      return false;
    });
    mockSafeReadSync.mockReturnValue(Buffer.from('# My Project\nError Handling section here'));

    const result = runHealthAudit();

    expect(result.warnings.some((w: string) => w.includes("'security'"))).toBe(true);
  });

  it('warns when CLAUDE.md is missing error handling section', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--is-inside-work-tree')) return 'true';
      if (cmd.includes('--show-toplevel')) return '/repo';
      if (cmd.includes('--porcelain')) return '';
      return '';
    });
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.endsWith('CLAUDE.md')) return true;
      return false;
    });
    mockSafeReadSync.mockReturnValue(Buffer.from('# My Project\nSecurity section here'));

    const result = runHealthAudit();

    expect(result.warnings.some((w: string) => w.includes("'error handling'"))).toBe(true);
  });

  it('reports uncommitted changes as advisory', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--is-inside-work-tree')) return 'true';
      if (cmd.includes('--show-toplevel')) return '/repo';
      if (cmd.includes('--porcelain')) return 'M file1.ts\nM file2.ts\n';
      return '';
    });
    mockExistsSync.mockReturnValue(false);

    const result = runHealthAudit();

    expect(result.advisories.some((a: string) => a.includes('uncommitted'))).toBe(true);
  });

  it('reports missing scaffold docs as advisory', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--is-inside-work-tree')) return 'true';
      if (cmd.includes('--show-toplevel')) return '/repo';
      if (cmd.includes('--porcelain')) return '';
      return '';
    });
    mockExistsSync.mockReturnValue(false);

    const result = runHealthAudit();

    expect(result.advisories.some((a: string) => a.includes('Missing scaffold docs'))).toBe(true);
  });

  it('produces clean result when everything is present', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('--is-inside-work-tree')) return 'true';
      if (cmd.includes('--show-toplevel')) return '/repo';
      if (cmd.includes('--porcelain')) return '';
      return '';
    });
    // All files exist
    mockExistsSync.mockReturnValue(true);
    // CLAUDE.md has all needed content
    mockSafeReadSync.mockReturnValue(
      Buffer.from('# Project\n\nagent-sentry rules here\n\n## Security\n\n## Error Handling\n'),
    );

    const result = runHealthAudit();

    expect(result.criticals).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    // Only advisories about AgentSentry rules might appear
  });
});
