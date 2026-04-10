/**
 * auth.ts — Access key validation and rate limiting for AgentSentry MCP server.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';

/**
 * Validates an access key against the AGENT_SENTRY_ACCESS_KEY environment variable.
 * Returns true if the key matches or if no key is configured (with deprecation path).
 */
let authWarningLogged = false;

export function validateAccessKey(key: string): boolean {
  const expected = process.env.AGENT_SENTRY_ACCESS_KEY;
  if (!expected) {
    const requireAuth = process.env.AGENT_SENTRY_REQUIRE_AUTH;
    if (requireAuth === 'true' || requireAuth === '1') {
      if (!authWarningLogged) {
        console.error('[AgentSentry] AGENT_SENTRY_REQUIRE_AUTH is set but AGENT_SENTRY_ACCESS_KEY is not configured — rejecting all requests. Set AGENT_SENTRY_ACCESS_KEY to enable authenticated access.');
        authWarningLogged = true;
      }
      return false;
    }
    if (!authWarningLogged) {
      console.error('[AgentSentry] WARNING: No AGENT_SENTRY_ACCESS_KEY set — MCP server accepting all requests without authentication. Set AGENT_SENTRY_ACCESS_KEY to enable auth, or AGENT_SENTRY_REQUIRE_AUTH=true to reject unauthenticated requests.');
      authWarningLogged = true;
    }
    return true;
  }
  if (!key) {
    return false;
  }
  // Constant-time comparison to prevent timing attacks
  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(expected);
  if (keyBuf.length !== expectedBuf.length) {
    // Perform a dummy comparison to avoid leaking key length via timing
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(keyBuf, expectedBuf);
}

/**
 * Reset the auth warning state.
 * @internal Exported for testing only.
 */
export function _resetDeprecationWarning(): void {
  authWarningLogged = false;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  /**
   * Check if a request from the given IP should be allowed.
   * Returns true if allowed, false if rate limited.
   */
  check(ip: string): boolean;
  /**
   * Express-style middleware for HTTP servers.
   */
  middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void;
}

/**
 * Creates a rate limiter that tracks request counts per IP.
 * Rejects with HTTP 429 when the limit is exceeded.
 *
 * @param maxRequests Maximum requests allowed per window (default: 100)
 * @param windowMs Window duration in milliseconds (default: 60000 = 1 minute)
 */
export function createRateLimiter(
  maxRequests: number = 100,
  windowMs: number = 60000,
): RateLimiter {
  const store = new Map<string, RateLimitEntry>();
  const MAX_STORE_SIZE = 10000;

  // Periodic cleanup of expired entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(ip);
      }
    }
  }, windowMs);

  // Prevent the interval from keeping the process alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  function check(ip: string): boolean {
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now >= entry.resetAt) {
      // Enforce size limit to prevent memory exhaustion
      if (store.size >= MAX_STORE_SIZE && !store.has(ip)) {
        // Emergency cleanup: remove all expired entries
        for (const [key, val] of store) {
          if (now >= val.resetAt) store.delete(key);
        }
        // If still over limit, reject (DoS protection)
        if (store.size >= MAX_STORE_SIZE) {
          return false;
        }
      }
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      return false;
    }

    return true;
  }

  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const ip = req.socket?.remoteAddress ?? 'unknown';
    if (!check(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too Many Requests', retryAfterMs: windowMs }));
      return;
    }
    next();
  }

  return { check, middleware };
}
