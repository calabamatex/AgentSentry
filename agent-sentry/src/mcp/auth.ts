/**
 * auth.ts — Access key validation and rate limiting for AgentSentry MCP server.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { timingSafeStringEqual } from '../utils/timing-safe';

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

  // Constant-time comparison to prevent timing attacks (shared util, WI-003)
  return timingSafeStringEqual(key, expected);
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
    if (!check(deriveRateLimitKey(req))) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too Many Requests', retryAfterMs: windowMs }));
      return;
    }
    next();
  }

  return { check, middleware };
}

/**
 * Derives the rate-limit bucket key for a request (WI-010).
 *
 * Precedence:
 *  1. Authenticated caller (`x-agent-sentry-key` present) → per-key bucket
 *     (`key:<sha256>`), so two keys sharing one NAT/proxy IP get independent
 *     buckets and one caller can't exhaust another's budget.
 *  2. `AGENT_SENTRY_TRUST_PROXY=1|true` → the first `X-Forwarded-For` hop
 *     (`ip:<hop>`). The header is honored ONLY when this is set; otherwise it
 *     is ignored (untrusted by default — clients cannot forge their bucket).
 *  3. Otherwise → the socket peer address (`ip:<remoteAddress>`).
 */
export function deriveRateLimitKey(req: IncomingMessage): string {
  const headers = req.headers ?? {};
  const accessKey = headers['x-agent-sentry-key'];
  if (typeof accessKey === 'string' && accessKey.length > 0) {
    return `key:${createHash('sha256').update(accessKey).digest('hex')}`;
  }

  const trustProxy = process.env.AGENT_SENTRY_TRUST_PROXY;
  if (trustProxy === '1' || trustProxy === 'true') {
    const xff = headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    const firstHop = raw?.split(',')[0]?.trim();
    if (firstHop) {
      return `ip:${firstHop}`;
    }
  }

  return `ip:${req.socket?.remoteAddress ?? 'unknown'}`;
}
