/**
 * Prototype pollution attack vectors.
 */

import { describe, it, expect } from 'vitest';
import { safeJsonParse, SafeJsonError } from '../../src/utils/safe-json';

describe('Prototype pollution prevention', () => {
  it('safeJsonParse rejects __proto__ key', () => {
    const json = '{"__proto__": {"isAdmin": true}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('__proto__');
  });

  it('safeJsonParse rejects constructor key', () => {
    const json = '{"constructor": {"prototype": {"polluted": true}}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('constructor');
  });

  it('safeJsonParse rejects prototype key', () => {
    const json = '{"prototype": {"polluted": true}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('prototype');
  });

  it('rejects nested __proto__ key', () => {
    const json = '{"data": {"__proto__": {"isAdmin": true}}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
  });

  it('does not pollute Object.prototype after parse attempt', () => {
    const before = (Object.prototype as any).isAdmin;

    try {
      safeJsonParse('{"__proto__": {"isAdmin": true}}');
    } catch {
      // Expected
    }

    // Object.prototype should NOT have been modified
    expect((Object.prototype as any).isAdmin).toBe(before);
    expect(({} as any).isAdmin).toBeUndefined();
  });
});
