import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse, output, table, isJson } from '../../src/cli/parser';

describe('CLI Parser', () => {
  describe('parse()', () => {
    it('parses a bare command', () => {
      const result = parse(['node', 'agent-sentry', 'health']);
      expect(result.command).toBe('health');
      expect(result.positionals).toEqual([]);
      expect(result.flags).toEqual({});
    });

    it('parses command with positional args', () => {
      const result = parse(['node', 'agent-sentry', 'memory', 'search', 'auth patterns']);
      expect(result.command).toBe('memory');
      expect(result.positionals).toEqual(['search', 'auth patterns']);
    });

    it('parses --flag as boolean true', () => {
      const result = parse(['node', 'agent-sentry', 'health', '--json']);
      expect(result.command).toBe('health');
      expect(result.flags['json']).toBe(true);
    });

    it('parses --key value pairs', () => {
      const result = parse(['node', 'agent-sentry', 'memory', 'list', '--limit', '50']);
      expect(result.command).toBe('memory');
      expect(result.flags['limit']).toBe('50');
    });

    it('parses --key=value syntax', () => {
      const result = parse(['node', 'agent-sentry', 'config', '--format=json']);
      expect(result.flags['format']).toBe('json');
    });

    it('parses --no-flag as boolean false', () => {
      const result = parse(['node', 'agent-sentry', 'stream', '--no-heartbeat']);
      expect(result.flags['heartbeat']).toBe(false);
    });

    it('parses short flags', () => {
      const result = parse(['node', 'agent-sentry', 'health', '-j']);
      expect(result.flags['j']).toBe(true);
    });

    it('parses short flag with value', () => {
      const result = parse(['node', 'agent-sentry', 'memory', 'list', '-n', '5']);
      expect(result.flags['n']).toBe('5');
    });

    it('treats everything after -- as positional', () => {
      const result = parse(['node', 'agent-sentry', 'config', '--', '--not-a-flag', 'val']);
      expect(result.positionals).toContain('--not-a-flag');
      expect(result.positionals).toContain('val');
      expect(result.flags).toEqual({});
    });

    it('returns undefined command when none given', () => {
      const result = parse(['node', 'agent-sentry']);
      expect(result.command).toBeUndefined();
    });

    it('handles mixed flags and positionals', () => {
      const result = parse(['node', 'agent-sentry', 'plugin', 'search', '--category', 'monitor', 'auth', '--json']);
      expect(result.command).toBe('plugin');
      expect(result.positionals).toEqual(['search', 'auth']);
      expect(result.flags['category']).toBe('monitor');
      expect(result.flags['json']).toBe(true);
    });
  });

  describe('isJson()', () => {
    it('returns true for --json flag', () => {
      expect(isJson({ json: true })).toBe(true);
    });

    it('returns true for -j flag', () => {
      expect(isJson({ j: true })).toBe(true);
    });

    it('returns false when neither set', () => {
      expect(isJson({ other: 'val' })).toBe(false);
    });
  });

  describe('output()', () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      writeSpy.mockRestore();
    });

    it('writes JSON when json=true', () => {
      output({ status: 'ok' }, true);
      const written = writeSpy.mock.calls[0][0] as string;
      expect(JSON.parse(written.trim())).toEqual({ status: 'ok' });
    });

    it('writes plain string when json=false', () => {
      output('hello world', false);
      expect(writeSpy).toHaveBeenCalledWith('hello world\n');
    });

    it('writes JSON for objects even when json=false', () => {
      output({ key: 'val' }, false);
      const written = writeSpy.mock.calls[0][0] as string;
      expect(JSON.parse(written.trim())).toEqual({ key: 'val' });
    });
  });

  describe('table()', () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      writeSpy.mockRestore();
    });

    it('prints (no data) for empty arrays', () => {
      table([]);
      expect(writeSpy).toHaveBeenCalledWith('(no data)\n');
    });

    it('prints a formatted table with header and separator', () => {
      table([
        { name: 'foo', version: '1.0' },
        { name: 'bar', version: '2.0' },
      ]);
      const calls = writeSpy.mock.calls.map((c) => c[0] as string);
      const all = calls.join('');
      expect(all).toContain('name');
      expect(all).toContain('version');
      expect(all).toContain('foo');
      expect(all).toContain('bar');
      expect(all).toContain('---');
    });

    it('respects custom columns', () => {
      table([{ a: 1, b: 2, c: 3 }], ['a', 'c']);
      const all = writeSpy.mock.calls.map((c) => c[0] as string).join('');
      expect(all).toContain('a');
      expect(all).toContain('c');
      expect(all).not.toContain('b');
    });
  });
});
