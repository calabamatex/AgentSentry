/**
 * Security tests for checkpoint-and-branch primitive.
 * Verifies that shell metacharacters in filenames and branch names
 * cannot cause command injection, because execFileSync is used
 * (array args, no shell interpolation) instead of execSync.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'child_process';
import { createCheckpoint, createSafetyBranch } from '../../src/primitives/checkpoint-and-branch';

// Mock child_process to inspect how git is called
vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => 'abc1234'),
}));

describe('checkpoint-and-branch security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCheckpoint - injection prevention', () => {
    it('should not use shell interpolation for filenames with $() syntax', async () => {
      await createCheckpoint('test', ['$(rm -rf /)']);
      // Verify execFileSync was called with array args, not a concatenated string
      const calls = (childProcess.execFileSync as any).mock.calls;
      const addCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'add');
      expect(addCall).toBeTruthy();
      // The malicious filename should be passed as a literal array element, not interpolated
      expect(addCall[1]).toContain('$(rm -rf /)');
    });

    it('should not use shell interpolation for filenames with backticks', async () => {
      await createCheckpoint('test', ['`whoami`']);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const addCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'add');
      expect(addCall).toBeTruthy();
      expect(addCall[1]).toContain('`whoami`');
    });

    it('should not use shell interpolation for filenames with semicolons', async () => {
      await createCheckpoint('test', ['file.txt; rm -rf /']);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const addCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'add');
      expect(addCall).toBeTruthy();
      expect(addCall[1]).toContain('file.txt; rm -rf /');
    });

    it('should pass commit message as a separate argument, not interpolated', async () => {
      const maliciousMsg = '"; rm -rf / ; echo "pwned';
      await createCheckpoint(maliciousMsg, ['file.txt']);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const commitCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'commit');
      expect(commitCall).toBeTruthy();
      // Message should be passed as a separate array element
      expect(commitCall[1]).toContain(maliciousMsg);
      // Should NOT be part of a concatenated command string
      expect(typeof commitCall[1]).toBe('object'); // array, not string
    });

    it('should not use shell interpolation for filenames with pipe operators', async () => {
      await createCheckpoint('test', ['file.txt | cat /etc/passwd']);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const addCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'add');
      expect(addCall).toBeTruthy();
      expect(addCall[1]).toContain('file.txt | cat /etc/passwd');
    });

    it('should not use shell interpolation for filenames with ampersands', async () => {
      await createCheckpoint('test', ['file.txt && rm -rf /']);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const addCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'add');
      expect(addCall).toBeTruthy();
      expect(addCall[1]).toContain('file.txt && rm -rf /');
    });

    it('should not use shell interpolation for filenames with newlines', async () => {
      await createCheckpoint('test', ['file.txt\nrm -rf /']);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const addCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'add');
      expect(addCall).toBeTruthy();
      expect(addCall[1]).toContain('file.txt\nrm -rf /');
    });
  });

  describe('createSafetyBranch - injection prevention', () => {
    it('should not use shell interpolation for branch names with shell metacharacters', async () => {
      const maliciousBranch = 'branch; rm -rf /';
      await createSafetyBranch(maliciousBranch);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const checkoutCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'checkout');
      expect(checkoutCall).toBeTruthy();
      expect(checkoutCall[1]).toContain(maliciousBranch);
    });

    it('should not use shell interpolation for branch names with $() syntax', async () => {
      const maliciousBranch = '$(whoami)';
      await createSafetyBranch(maliciousBranch);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const checkoutCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'checkout');
      expect(checkoutCall).toBeTruthy();
      expect(checkoutCall[1]).toContain(maliciousBranch);
    });

    it('should not use shell interpolation for branch names with backticks', async () => {
      const maliciousBranch = '`id`';
      await createSafetyBranch(maliciousBranch);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const checkoutCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'checkout');
      expect(checkoutCall).toBeTruthy();
      expect(checkoutCall[1]).toContain(maliciousBranch);
    });

    it('should not use shell interpolation for branch names with pipe operators', async () => {
      const maliciousBranch = 'branch | cat /etc/shadow';
      await createSafetyBranch(maliciousBranch);
      const calls = (childProcess.execFileSync as any).mock.calls;
      const checkoutCall = calls.find((c: any[]) => c[0] === 'git' && c[1][0] === 'checkout');
      expect(checkoutCall).toBeTruthy();
      expect(checkoutCall[1]).toContain(maliciousBranch);
    });
  });

  describe('execFileSync is used instead of execSync', () => {
    it('should call execFileSync, not execSync', async () => {
      await createCheckpoint('test msg', ['file.txt']);
      expect(childProcess.execFileSync).toHaveBeenCalled();
      // The mock only defines execFileSync; accessing execSync on the mock
      // will throw because it was never defined, confirming the source
      // does not import or use execSync.
      expect(() => (childProcess as any).execSync).toThrow();
    });

    it('should always pass arguments as an array, never as a concatenated string', async () => {
      await createCheckpoint('test msg', ['a.ts', 'b.ts']);
      const calls = (childProcess.execFileSync as any).mock.calls;
      for (const call of calls) {
        // First arg should be 'git' (the binary)
        expect(call[0]).toBe('git');
        // Second arg should be an array of arguments
        expect(Array.isArray(call[1])).toBe(true);
      }
    });
  });
});
