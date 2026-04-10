/**
 * safe-io.ts — Safe file I/O with symlink protection and atomic writes.
 *
 * Security rationale:
 * - Deterministic temp file names can be pre-created as symlinks,
 *   redirecting writes to arbitrary files.
 * - Symlink targets can change between check and use (TOCTOU), but
 *   lstat + O_EXCL narrows the window.
 * - Without fsync + rename, power loss or crash can leave partial files.
 *
 * Provides:
 * - atomicWriteSync: random temp name, lstat check, fsync, rename
 * - isSymlink: safe symlink detection
 * - ensureDirectorySafe: mkdir with restricted permissions + symlink check
 * - safeReadSync: read with symlink rejection
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

export class SafeIoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeIoError';
  }
}

/**
 * Check if a path is a symlink.
 * Returns false if the path doesn't exist (safe to create).
 */
export function isSymlink(targetPath: string): boolean {
  try {
    const stat = fs.lstatSync(targetPath);
    return stat.isSymbolicLink();
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw e;
  }
}

/**
 * Write data to a file atomically with symlink protection.
 *
 * Security guarantees:
 * 1. Rejects symlink targets.
 * 2. Uses crypto.randomBytes for temp name (no predictable suffix).
 * 3. fsync before rename (crash-safe).
 * 4. Restricted permissions (0o600 by default).
 */
export function atomicWriteSync(
  targetPath: string,
  data: string | Buffer,
  mode: number = 0o600,
): void {
  const resolvedTarget = path.resolve(targetPath);
  const dir = path.dirname(resolvedTarget);

  // Reject symlink targets
  if (isSymlink(resolvedTarget)) {
    throw new SafeIoError(
      `Refusing to write: target is a symlink: ${resolvedTarget}`
    );
  }

  // Ensure parent directory exists
  ensureDirectorySafe(dir);

  // Create temp file with random name in same directory
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  const tempPath = path.join(dir, `.tmp-${randomSuffix}`);

  try {
    // Write with restricted permissions, O_EXCL prevents overwriting existing
    const fd = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      mode,
    );
    try {
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
      let offset = 0;
      while (offset < buf.length) {
        const written = fs.writeSync(fd, buf, offset);
        if (written === 0) {
          throw new SafeIoError('fs.writeSync returned 0 bytes');
        }
        offset += written;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // Atomic rename
    fs.renameSync(tempPath, resolvedTarget);
  } catch (e) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    if (e instanceof SafeIoError) throw e;
    throw e;
  }
}

/**
 * Create a directory with safe permissions, rejecting symlinks.
 */
export function ensureDirectorySafe(
  dirPath: string,
  mode: number = 0o700,
): void {
  const resolved = path.resolve(dirPath);

  if (isSymlink(resolved)) {
    throw new SafeIoError(
      `Refusing to create directory: path is a symlink: ${resolved}`
    );
  }

  fs.mkdirSync(resolved, { recursive: true, mode });
}

/**
 * Read a file, rejecting symlinks.
 */
export function safeReadSync(filePath: string): Buffer {
  const resolved = path.resolve(filePath);
  if (isSymlink(resolved)) {
    throw new SafeIoError(
      `Refusing to read: path is a symlink: ${resolved}`
    );
  }
  return fs.readFileSync(resolved);
}
