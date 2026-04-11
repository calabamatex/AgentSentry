/**
 * auth.ts — Access key validation and rate limiting for AgentSentry MCP server.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';

/**
 * Validates an access key against the AGENT_SENTRY_ACCESS_KEY environment variable.
 *
 * Default behavior (v0.6.0+): REJECT all requests unless AGENT_SENTRY_ACCESS_KEY is set.
 * Opt-out: Set AGENT_SENTRY_NO_AUTH=true for local development (unsafe).
 *
 * BREAKING CHANGE in v0.6.0: Previously accepted all requests when no key was configured.
 * The deprecated AGENT_SENTRY_REQUIRE_AUTH variable has been removed.
 *
 * Uses process.stderr.write (not Logger) because auth runs before Logger may be
 * initialized in the MCP server startup path.
 */
let authWarningLogged = false;

export function validateAccessKey(key: string): boolean {
  const expected = process.env.AGENT_SENTRY_ACCESS_KEY;
  const noAuth = process.env.AGENT_SENTRY_NO_AUTH;

  // Explicit opt-out for local development
  if (noAuth === 'true' || noAuth === '1') {
    if (!authWarningLogged) {
      process.stderr.write(
        '[AgentSentry] WARNING: AGENT_SENTRY_NO_AUTH is set — MCP server accepting ' +
        'all requests WITHOUT authentication. Do not use in production.\n'
      );
      authWarningLogged = true;
    }
    return true;
  }

  // Default: require access key
  if (!expected) {
    if (!authWarningLogged) {
      process.stderr.write(
        '[AgentSentry] ERROR: AGENT_SENTRY_ACCESS_KEY not configured. ' +
        'Set an access key to start the MCP server, or set ' +
        'AGENT_SENTRY_NO_AUTH=true for local development (unsafe).\n'
      );
      authWarningLogged = true;
    }
    return false;
  }

  if (!key) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(expected);
  if (keyBuf.length !== expectedBuf.length) {
    // Dummy comparison to avoid leaking key length via timing
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(keyBuf, expectedBuf);
}

/**
 * Reset the auth warning flag.
 * @internal Exported for testing only.
 */
export function resetAuthWarning(): void {
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
