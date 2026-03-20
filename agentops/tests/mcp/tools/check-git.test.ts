/**
 * check-git.test.ts — Tests for agentops_check_git tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'child_process';
import { handler } from '../../../src/mcp/tools/check-git';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = childProcess.execSync as unknown as ReturnType<typeof vi.fn>;

describe('agentops_check_git', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return clean state for clean repo', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('status --porcelain')) return '';
      if (cmd.includes('--format=%cr')) return '5 minutes ago';
      if (cmd.includes('--show-current')) return 'feature/test';
      if (cmd.includes('--format=%ct')) return String(Math.floor(Date.now() / 1000));
      return '';
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
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('status --porcelain')) return ' M src/file.ts\n?? new-file.ts';
      if (cmd.includes('--format=%cr')) return '30 minutes ago';
      if (cmd.includes('--show-current')) return 'feature/test';
      if (cmd.includes('--format=%ct')) return String(Math.floor(Date.now() / 1000));
      return '';
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.uncommitted_files).toHaveLength(2);
      expect(parsed.risk_score).toBeGreaterThanOrEqual(3);
    });
  });

  it('should add risk for main branch', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('status --porcelain')) return '';
      if (cmd.includes('--format=%cr')) return '5 minutes ago';
      if (cmd.includes('--show-current')) return 'main';
      if (cmd.includes('--format=%ct')) return String(Math.floor(Date.now() / 1000));
      return '';
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.is_main).toBe(true);
      expect(parsed.risk_score).toBeGreaterThanOrEqual(5);
    });
  });

  it('should add risk for master branch', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('status --porcelain')) return '';
      if (cmd.includes('--format=%cr')) return '5 minutes ago';
      if (cmd.includes('--show-current')) return 'master';
      if (cmd.includes('--format=%ct')) return String(Math.floor(Date.now() / 1000));
      return '';
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.is_main).toBe(true);
    });
  });

  it('should add risk for old commits', () => {
    const twoHoursAgo = Math.floor((Date.now() - 7200000) / 1000);
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('status --porcelain')) return '';
      if (cmd.includes('--format=%cr')) return '2 hours ago';
      if (cmd.includes('--show-current')) return 'feature/test';
      if (cmd.includes('--format=%ct')) return String(twoHoursAgo);
      return '';
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.risk_score).toBeGreaterThanOrEqual(2);
    });
  });

  it('should accumulate multiple risks', () => {
    const twoHoursAgo = Math.floor((Date.now() - 7200000) / 1000);
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('status --porcelain')) return ' M file.ts';
      if (cmd.includes('--format=%cr')) return '2 hours ago';
      if (cmd.includes('--show-current')) return 'main';
      if (cmd.includes('--format=%ct')) return String(twoHoursAgo);
      return '';
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      // 3 (uncommitted) + 5 (main) + 2 (old commit) = 10
      expect(parsed.risk_score).toBe(10);
    });
  });

  it('should handle git command failures gracefully', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    return handler({}).then((result) => {
      const parsed = JSON.parse(result.content[0].text);
      // Should still return a result, just with empty/default values
      expect(parsed.uncommitted_files).toEqual([]);
    });
  });
});
