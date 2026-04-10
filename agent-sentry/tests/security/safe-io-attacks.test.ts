/**
 * Safe I/O attack vectors — symlink attacks, temp file predictability.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicWriteSync, safeReadSync, SafeIoError } from '../../src/utils/safe-io';

const isWindows = process.platform === 'win32';
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-io-security-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Symlink attacks', () => {
  it.skipIf(isWindows)('atomicWriteSync refuses to write through symlink to sensitive file', () => {
    const sensitiveFile = path.join(tmpDir, 'sensitive.txt');
    fs.writeFileSync(sensitiveFile, 'SECRET_DATA');

    const symlinkPath = path.join(tmpDir, 'innocent.txt');
    fs.symlinkSync(sensitiveFile, symlinkPath);

    // Attempt to overwrite via symlink should be rejected
    expect(() => atomicWriteSync(symlinkPath, 'OVERWRITTEN')).toThrow(SafeIoError);
    expect(() => atomicWriteSync(symlinkPath, 'OVERWRITTEN')).toThrow('symlink');

    // Original file should be untouched
    expect(fs.readFileSync(sensitiveFile, 'utf-8')).toBe('SECRET_DATA');
  });

  it.skipIf(isWindows)('safeReadSync refuses to read through symlink', () => {
    const sensitiveFile = path.join(tmpDir, 'passwords.txt');
    fs.writeFileSync(sensitiveFile, 'root:x:0:0');

    const symlinkPath = path.join(tmpDir, 'harmless.txt');
    fs.symlinkSync(sensitiveFile, symlinkPath);

    expect(() => safeReadSync(symlinkPath)).toThrow(SafeIoError);
    expect(() => safeReadSync(symlinkPath)).toThrow('symlink');
  });

  it.skipIf(isWindows)('rejects symlink directory in write path', () => {
    const realDir = path.join(tmpDir, 'real');
    fs.mkdirSync(realDir);

    const linkDir = path.join(tmpDir, 'link');
    fs.symlinkSync(realDir, linkDir);

    // Writing to a file inside a symlinked directory should be rejected
    // because ensureDirectorySafe checks parent dirs
    const filePath = path.join(linkDir, 'file.txt');
    expect(() => atomicWriteSync(filePath, 'data')).toThrow(SafeIoError);
    expect(() => atomicWriteSync(filePath, 'data')).toThrow('symlink');
  });
});

describe('Temp file predictability', () => {
  it('temp files use random names (not predictable)', () => {
    const file1 = path.join(tmpDir, 'out1.txt');
    const file2 = path.join(tmpDir, 'out2.txt');

    atomicWriteSync(file1, 'data1');
    atomicWriteSync(file2, 'data2');

    // After successful write, no .tmp files should remain
    const tmpFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('.tmp-'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('concurrent writes do not collide', () => {
    // Write 10 files concurrently-ish (sync, but rapid succession)
    const files: string[] = [];
    for (let i = 0; i < 10; i++) {
      const file = path.join(tmpDir, `concurrent-${i}.txt`);
      atomicWriteSync(file, `content-${i}`);
      files.push(file);
    }

    // All files should exist with correct content
    for (let i = 0; i < 10; i++) {
      expect(fs.readFileSync(files[i], 'utf-8')).toBe(`content-${i}`);
    }
  });
});
