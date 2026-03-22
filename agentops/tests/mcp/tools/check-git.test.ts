/**
 * check-git.test.ts — Tests for agentops_check_git tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'child_process';
import { handler } from '../../../src/mcp/tools/check-git';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = childProcess.execFileSync as unknown as ReturnType<typeof vi.fn>;

/**
 * The source now uses execFileSync('git', args, opts).
 * The mock matches on the args array (second argument).
 */
function setupGitMock(responses: Record<string, string>) {
  mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
    const joined = args.join(' ');
    for (const [pattern, value] of Object.entries(responses)) {
      if (joined.includes(pattern)) return value;
    }
    return '';
  });
}

describe('agentops_check_git', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return clean state for clean repo', () => {
    setupGitMock({
      'status --porcelain': '',
      '--format=%cr': '5 minutes ago',
      '--show-current': 'feature/test',
      '--format=%ct': String(Math.floor(Date.now() / 1000)),
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.uncommitted_files).toEqual([]);
      expect(parsed.last_commit_age).toBe('5 minutes ago');
      expect(parsed.current_branch).toBe('feature/test');
      expect(parsed.is_main).toBe(false);
      expect(parsed.risk_score).toBe(0);
    });
  });

  it('should detect uncommitted files and add risk', () => {
    setupGitMock({
      'status --porcelain': ' M src/file.ts\n?? new-file.ts',
      '--format=%cr': '30 minutes ago',
      '--show-current': 'feature/test',
      '--format=%ct': String(Math.floor(Date.now() / 1000)),
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.uncommitted_files).toHaveLength(2);
      expect(parsed.risk_score).toBeGreaterThanOrEqual(3);
    });
  });

  it('should add risk for main branch', () => {
    setupGitMock({
      'status --porcelain': '',
      '--format=%cr': '5 minutes ago',
      '--show-current': 'main',
      '--format=%ct': String(Math.floor(Date.now() / 1000)),
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.is_main).toBe(true);
      expect(parsed.risk_score).toBeGreaterThanOrEqual(5);
    });
  });

  it('should add risk for master branch', () => {
    setupGitMock({
      'status --porcelain': '',
      '--format=%cr': '5 minutes ago',
      '--show-current': 'master',
      '--format=%ct': String(Math.floor(Date.now() / 1000)),
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.is_main).toBe(true);
    });
  });

  it('should add risk for old commits', () => {
    const twoHoursAgo = Math.floor((Date.now() - 7200000) / 1000);
    setupGitMock({
      'status --porcelain': '',
      '--format=%cr': '2 hours ago',
      '--show-current': 'feature/test',
      '--format=%ct': String(twoHoursAgo),
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.risk_score).toBeGreaterThanOrEqual(2);
    });
  });

  it('should accumulate multiple risks', () => {
    const twoHoursAgo = Math.floor((Date.now() - 7200000) / 1000);
    setupGitMock({
      'status --porcelain': ' M file.ts',
      '--format=%cr': '2 hours ago',
      '--show-current': 'main',
      '--format=%ct': String(twoHoursAgo),
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      // 3 (uncommitted) + 5 (main) + 2 (old commit) = 10
      expect(parsed.risk_score).toBe(10);
    });
  });

  it('should handle git command failures gracefully', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      // Should still return a result, just with empty/default values
      expect(parsed.uncommitted_files).toEqual([]);
    });
  });
});
