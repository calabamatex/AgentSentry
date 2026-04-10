import { describe, it, expect } from 'vitest';
import { safeJsonParse, safeJsonStringify, SafeJsonError } from '../../src/utils/safe-json';

describe('safeJsonParse', () => {
  it('accepts valid JSON objects', () => {
    const result = safeJsonParse<{ a: number; b: string }>('{"a": 1, "b": "hello"}');
    expect(result).toEqual({ a: 1, b: 'hello' });
  });

  it('accepts empty objects', () => {
    expect(safeJsonParse('{}')).toEqual({});
  });

  it('accepts nested objects with unique keys', () => {
    const json = '{"a": {"x": 1, "y": 2}, "b": {"x": 3, "y": 4}}';
    const result = safeJsonParse(json);
    expect(result).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
  });

  it('accepts arrays correctly', () => {
    const json = '{"items": [1, 2, 3], "tags": ["a", "b"]}';
    const result = safeJsonParse<{ items: number[]; tags: string[] }>(json);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.tags).toEqual(['a', 'b']);
  });

  it('rejects duplicate keys at top level', () => {
    const json = '{"status": "ok", "status": "error"}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('Duplicate JSON key: "status"');
  });

  it('rejects duplicate keys in nested objects', () => {
    const json = '{"outer": {"inner": 1, "inner": 2}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('Duplicate JSON key: "inner"');
  });

  it('rejects duplicate keys with different values', () => {
    const json = '{"id": 1, "name": "Alice", "id": 2}';
    expect(() => safeJsonParse(json)).toThrow('Duplicate JSON key: "id"');
  });

  it('rejects __proto__ key', () => {
    const json = '{"__proto__": {"isAdmin": true}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('Dangerous JSON key rejected: "__proto__"');
  });

  it('rejects constructor key', () => {
    const json = '{"constructor": {"prototype": {}}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('Dangerous JSON key rejected: "constructor"');
  });

  it('rejects prototype key', () => {
    const json = '{"prototype": {"exploit": true}}';
    expect(() => safeJsonParse(json)).toThrow(SafeJsonError);
    expect(() => safeJsonParse(json)).toThrow('Dangerous JSON key rejected: "prototype"');
  });

  it('handles escaped quotes in keys correctly', () => {
    const json = '{"key\\"with\\"quotes": "value"}';
    const result = safeJsonParse<Record<string, string>>(json);
    expect(result['key"with"quotes']).toBe('value');
  });

  it('accepts valid JSON with special characters in values', () => {
    const json = '{"msg": "hello\\nworld", "path": "C:\\\\Users"}';
    const result = safeJsonParse<Record<string, string>>(json);
    expect(result.msg).toBe('hello\nworld');
    expect(result.path).toBe('C:\\Users');
  });

  it('throws on invalid JSON', () => {
    expect(() => safeJsonParse('{invalid}')).toThrow();
  });

  it('completes in <100ms for objects with >1000 keys', () => {
    const pairs = Array.from({ length: 1500 }, (_, i) => `"key_${i}": ${i}`);
    const json = `{${pairs.join(', ')}}`;

    const start = performance.now();
    const result = safeJsonParse<Record<string, number>>(json);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(result.key_0).toBe(0);
    expect(result.key_1499).toBe(1499);
  });
});

describe('safeJsonStringify', () => {
  it('produces deterministic output with sorted keys', () => {
    const obj1 = { z: 1, a: 2, m: 3 };
    const obj2 = { a: 2, m: 3, z: 1 };

    expect(safeJsonStringify(obj1)).toBe(safeJsonStringify(obj2));
    expect(safeJsonStringify(obj1)).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys', () => {
    const obj = { b: { z: 1, a: 2 }, a: { y: 3, x: 4 } };
    const result = safeJsonStringify(obj);
    expect(result).toBe('{"a":{"x":4,"y":3},"b":{"a":2,"z":1}}');
  });

  it('handles arrays without reordering', () => {
    const obj = { items: [3, 1, 2] };
    const result = safeJsonStringify(obj);
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('supports indentation', () => {
    const obj = { a: 1 };
    const result = safeJsonStringify(obj, 2);
    expect(result).toContain('\n');
    expect(result).toContain('  ');
  });

  it('handles null and primitives', () => {
    expect(safeJsonStringify(null)).toBe('null');
    expect(safeJsonStringify(42)).toBe('42');
    expect(safeJsonStringify('hello')).toBe('"hello"');
    expect(safeJsonStringify(true)).toBe('true');
  });
});
