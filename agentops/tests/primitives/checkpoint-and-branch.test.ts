/**
 * Tests for checkpoint-and-branch primitive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import {
  createCheckpoint,
  createSafetyBranch,
  getCurrentBranch,
} from '../../src/primitives/checkpoint-and-branch';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createCheckpoint', () => {
  it('should stage all files and commit when no files specified', async () => {
    mockExecSync
      .mockReturnValueOnce('' as any) // git add -A
      .mockReturnValueOnce('' as any) // git commit
      .mockReturnValueOnce('abc1234def5678\n' as any); // git rev-parse HEAD

    const result = await createCheckpoint('test checkpoint');

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234def5678');
    expect(result.message).toContain('abc1234');
    expect(mockExecSync).toHaveBeenCalledWith('git add -A', expect.any(Object));
    expect(mockExecSync).toHaveBeenCalledWith(
      'git commit -m "test checkpoint"',
      expect.any(Object)
    );
  });

  it('should stage specific files when provided', async () => {
    mockExecSync
      .mockReturnValueOnce('' as any) // git add specific files
      .mockReturnValueOnce('' as any) // git commit
      .mockReturnValueOnce('deadbeef\n' as any); // git rev-parse HEAD

    const result = await createCheckpoint('partial checkpoint', ['file1.ts', 'file2.ts']);

    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      'git add "file1.ts" "file2.ts"',
      expect.any(Object)
    );
  });

  it('should return failure on git error', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('nothing to commit');
    });

    const result = await createCheckpoint('empty checkpoint');

    expect(result.success).toBe(false);
    expect(result.message).toContain('nothing to commit');
    expect(result.commitHash).toBeUndefined();
  });

  it('should escape double quotes in commit message', async () => {
    mockExecSync
      .mockReturnValueOnce('' as any)
      .mockReturnValueOnce('' as any)
      .mockReturnValueOnce('abcdef12\n' as any);

    await createCheckpoint('fix "bug" in code');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git commit -m "fix \\"bug\\" in code"',
      expect.any(Object)
    );
  });
});

describe('createSafetyBranch', () => {
  it('should create a new branch', async () => {
    mockExecSync.mockReturnValueOnce('' as any);

    const result = await createSafetyBranch('safety/experiment-1');

    expect(result.success).toBe(true);
    expect(result.branch).toBe('safety/experiment-1');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git checkout -b "safety/experiment-1"',
      expect.any(Object)
    );
  });

  it('should return failure if branch exists', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('branch already exists');
    });

    const result = await createSafetyBranch('main');

    expect(result.success).toBe(false);
    expect(result.message).toContain('branch already exists');
  });
});

describe('getCurrentBranch', () => {
  it('should return the current branch name', async () => {
    mockExecSync.mockReturnValueOnce('feature/my-branch\n' as any);

    const branch = await getCurrentBranch();

    expect(branch).toBe('feature/my-branch');
    expect(mockExecSync).toHaveBeenCalledWith(
      'git branch --show-current',
      expect.any(Object)
    );
  });
});
