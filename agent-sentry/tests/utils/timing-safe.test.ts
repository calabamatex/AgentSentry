/**
 * timing-safe.test.ts — Unit tests for the shared constant-time comparator (WI-003).
 */

import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual } from '../../src/utils/timing-safe';

describe('timingSafeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('secret-token', 'secret-token')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeStringEqual('secret-token', 'secret-tokeX')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(timingSafeStringEqual('short', 'a-much-longer-string')).toBe(false);
    expect(timingSafeStringEqual('a-much-longer-string', 'short')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
    expect(timingSafeStringEqual('', 'nonempty')).toBe(false);
    expect(timingSafeStringEqual('nonempty', '')).toBe(false);
  });

  it('compares byte-wise, not codepoint-wise (multi-byte UTF-8)', () => {
    expect(timingSafeStringEqual('café', 'café')).toBe(true);
    // 'é' (2 bytes) vs 'e' (1 byte): different byte lengths despite equal
    // string length — must still be a plain mismatch, not a throw.
    expect(timingSafeStringEqual('café', 'cafe')).toBe(false);
  });
});
