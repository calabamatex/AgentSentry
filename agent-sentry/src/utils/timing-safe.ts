/**
 * timing-safe.ts — Constant-time string comparison shared by all auth layers.
 *
 * Extracted from src/mcp/auth.ts (WI-003) so the MCP access-key check and the
 * dashboard token check use one tested primitive instead of parallel
 * implementations that can drift.
 */

import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string equality to prevent timing attacks.
 *
 * On length mismatch, performs a dummy self-comparison before returning so
 * the early return does not leak the expected value's length via timing.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Dummy comparison to avoid leaking length via timing
    timingSafeEqual(bBuf, bBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
