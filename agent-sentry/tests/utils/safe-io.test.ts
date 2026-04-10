import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  atomicWriteSync,
  isSymlink,
  ensureDirectorySafe,
  safeReadSync,
  SafeIoError,
} from '../../src/utils/safe-io';

const isWindows = process.platform === 'win32';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-io-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isSymlink', () => {
  it('returns false for nonexistent path', () => {
    expect(isSymlink(path.join(tmpDir, 'no-such-file'))).toBe(false);
  });

  it('returns false for regular file', () => {
    const file = path.join(tmpDir, 'regular.txt');
    fs.writeFileSync(file, 'hello');
    expect(isSymlink(file)).toBe(false);
  });

  it.skipIf(isWindows)('returns true for symlink', () => {
    const target = path.join(tmpDir, 'target.txt');
    const link = path.join(tmpDir, 'link.txt');
    fs.writeFileSync(target, 'target content');
    fs.symlinkSync(target, link);
    expect(isSymlink(link)).toBe(true);
  });
});

describe('atomicWriteSync', () => {
  it('creates a file with correct content', () => {
    const file = path.join(tmpDir, 'output.txt');
    atomicWriteSync(file, 'hello world');
    expect(fs.readFileSync(file, 'utf-8')).toBe('hello world');
  });

  it('overwrites existing non-symlink file', () => {
    const file = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(file, 'old content');
    atomicWriteSync(file, 'new content');
    expect(fs.readFileSync(file, 'utf-8')).toBe('new content');
  });

  it('writes with restricted permissions (0o600)', () => {
    if (isWindows) return; // Permissions not meaningful on Windows
    const file = path.join(tmpDir, 'restricted.txt');
    atomicWriteSync(file, 'secret');
    const stat = fs.statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it.skipIf(isWindows)('rejects symlink target', () => {
    const target = path.join(tmpDir, 'real-target.txt');
    const link = path.join(tmpDir, 'symlink.txt');
    fs.writeFileSync(target, 'original');
    fs.symlinkSync(target, link);

    expect(() => atomicWriteSync(link, 'exploit')).toThrow(SafeIoError);
    expect(() => atomicWriteSync(link, 'exploit')).toThrow('target is a symlink');
    // Original file should be unchanged
    expect(fs.readFileSync(target, 'utf-8')).toBe('original');
  });

  it('leaves no temp file on failure', () => {
    // Write to a path where the parent is a file (not a directory)
    const blockingFile = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blockingFile, 'I am a file, not a dir');
    const badTarget = path.join(blockingFile, 'subdir', 'file.txt');

    expect(() => atomicWriteSync(badTarget, 'data')).toThrow();

    // No .tmp files should remain in tmpDir
    const tmpFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('.tmp-'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('creates parent directories recursively', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c', 'file.txt');
    atomicWriteSync(nested, 'deep');
    expect(fs.readFileSync(nested, 'utf-8')).toBe('deep');
  });

  it('file exists after write (proves fsync+rename happened)', () => {
    const file = path.join(tmpDir, 'synced.txt');
    atomicWriteSync(file, 'persisted');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe('persisted');
  });

  it('handles Buffer input', () => {
    const file = path.join(tmpDir, 'binary.bin');
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    atomicWriteSync(file, buf);
    expect(fs.readFileSync(file)).toEqual(buf);
  });
});

describe('ensureDirectorySafe', () => {
  it('creates directories recursively', () => {
    const nested = path.join(tmpDir, 'x', 'y', 'z');
    ensureDirectorySafe(nested);
    expect(fs.statSync(nested).isDirectory()).toBe(true);
  });

  it.skipIf(isWindows)('rejects symlink directory', () => {
    const realDir = path.join(tmpDir, 'real-dir');
    const linkDir = path.join(tmpDir, 'link-dir');
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, linkDir);

    expect(() => ensureDirectorySafe(linkDir)).toThrow(SafeIoError);
    expect(() => ensureDirectorySafe(linkDir)).toThrow('path is a symlink');
  });
});

describe('safeReadSync', () => {
  it('reads normal files', () => {
    const file = path.join(tmpDir, 'readable.txt');
    fs.writeFileSync(file, 'content');
    const result = safeReadSync(file);
    expect(result.toString('utf-8')).toBe('content');
  });

  it.skipIf(isWindows)('rejects symlink reads', () => {
    const target = path.join(tmpDir, 'secret.txt');
    const link = path.join(tmpDir, 'link-to-secret.txt');
    fs.writeFileSync(target, 'secret data');
    fs.symlinkSync(target, link);

    expect(() => safeReadSync(link)).toThrow(SafeIoError);
    expect(() => safeReadSync(link)).toThrow('path is a symlink');
  });

  it('throws on nonexistent file', () => {
    expect(() => safeReadSync(path.join(tmpDir, 'nope.txt'))).toThrow();
  });
});
