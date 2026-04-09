/**
 * auth.ts — Access key validation and rate limiting for AgentSentry MCP server.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'mcp-auth' });

/**
 * When set to true (v0.6.0+), unauthenticated requests are rejected by default.
 * Set AGENT_SENTRY_NO_AUTH=true to opt out (local dev only).
 */
const AUTH_REQUIRED_BY_DEFAULT = false;

/** Track whether we've already logged the deprecation warning this session. */
let deprecationWarned = false;

/**
 * Validates an access key against the AGENT_SENTRY_ACCESS_KEY environment variable.
 * Returns true if the key matches or if no key is configured (with deprecation path).
 */
export function validateAccessKey(key: string): boolean {
  const expected = process.env.AGENT_SENTRY_ACCESS_KEY;
  if (!expected) {
    // Check for explicit opt-out
    const noAuth = process.env.AGENT_SENTRY_NO_AUTH;
    if (noAuth === 'true' || noAuth === '1') {
      return true;
    }

    if (AUTH_REQUIRED_BY_DEFAULT) {
      logger.error('Authentication required but no AGENT_SENTRY_ACCESS_KEY set. '
        + 'Set AGENT_SENTRY_NO_AUTH=true to opt out (local dev only).');
      return false;
    }

    // v0.5.x: allow with deprecation warning (once per session)
    if (!deprecationWarned) {
      deprecationWarned = true;
      logger.warn('MCP server running without authentication. '
        + 'Set AGENT_SENTRY_ACCESS_KEY to enable auth. '
        + 'Starting in v0.6.0, authentication will be REQUIRED by default. '
        + 'To opt out (local dev only): set AGENT_SENTRY_NO_AUTH=true');
    }
    return true;
  }
  if (!key) {
    return false;
  }
  // Constant-time comparison to prevent timing attacks.
  // Even on length mismatch we do a dummy comparison to avoid leaking
  // key length via timing.
  if (key.length !== expected.length) {
    // Dummy comparison against expected to burn constant time
    let dummy = 0;
    for (let i = 0; i < expected.length; i++) {
      dummy |= expected.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    void dummy;
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < key.length; i++) {
    mismatch |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Reset the deprecation warning state.
 * @internal Exported for testing only.
 */
export function _resetDeprecationWarning(): void {
  deprecationWarned = false;
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
