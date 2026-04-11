/**
 * auth.test.ts — Tests for access key validation and rate limiter.
 *
 * v0.6.0+ semantics: MCP auth is secure-by-default.
 *   - Default: reject unauthenticated requests unless AGENT_SENTRY_ACCESS_KEY is set.
 *   - AGENT_SENTRY_NO_AUTH=true/1 opts out for local development (with stderr warning).
 *   - AGENT_SENTRY_REQUIRE_AUTH removed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAccessKey, createRateLimiter, resetAuthWarning } from '../../src/mcp/auth';
import { IncomingMessage, ServerResponse } from 'http';

describe('validateAccessKey', () => {
  const originalAccessKey = process.env.AGENT_SENTRY_ACCESS_KEY;
  const originalNoAuth = process.env.AGENT_SENTRY_NO_AUTH;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAuthWarning();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    delete process.env.AGENT_SENTRY_ACCESS_KEY;
    delete process.env.AGENT_SENTRY_NO_AUTH;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalAccessKey === undefined) {
      delete process.env.AGENT_SENTRY_ACCESS_KEY;
    } else {
      process.env.AGENT_SENTRY_ACCESS_KEY = originalAccessKey;
    }
    if (originalNoAuth === undefined) {
      delete process.env.AGENT_SENTRY_NO_AUTH;
    } else {
      process.env.AGENT_SENTRY_NO_AUTH = originalNoAuth;
    }
  });

  // ── Default-deny behavior (secure-by-default) ───────────────────────────

  it('rejects all requests when no key configured and NO_AUTH not set (default-deny)', () => {
    expect(validateAccessKey('anything')).toBe(false);
    expect(validateAccessKey('')).toBe(false);
  });

  it('emits a stderr ERROR once when rejecting due to missing key', () => {
    validateAccessKey('first');
    validateAccessKey('second');
    validateAccessKey('third');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const msg = stderrSpy.mock.calls[0][0] as string;
    expect(msg).toContain('AGENT_SENTRY_ACCESS_KEY not configured');
  });

  // ── NO_AUTH opt-out ──────────────────────────────────────────────────────

  it('allows all requests when AGENT_SENTRY_NO_AUTH=true (opt-out)', () => {
    process.env.AGENT_SENTRY_NO_AUTH = 'true';
    expect(validateAccessKey('anything')).toBe(true);
    expect(validateAccessKey('')).toBe(true);
  });

  it('allows all requests when AGENT_SENTRY_NO_AUTH=1', () => {
    process.env.AGENT_SENTRY_NO_AUTH = '1';
    expect(validateAccessKey('anything')).toBe(true);
  });

  it('emits a stderr WARNING once when NO_AUTH is enabled', () => {
    process.env.AGENT_SENTRY_NO_AUTH = 'true';
    validateAccessKey('first');
    validateAccessKey('second');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const msg = stderrSpy.mock.calls[0][0] as string;
    expect(msg).toContain('AGENT_SENTRY_NO_AUTH');
    expect(msg).toContain('WARNING');
  });

  it('ignores NO_AUTH values other than "true"/"1"', () => {
    process.env.AGENT_SENTRY_NO_AUTH = 'yes';
    // Falls through to default-deny
    expect(validateAccessKey('anything')).toBe(false);
  });

  // ── Normal key validation ───────────────────────────────────────────────

  it('returns true for matching key', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'my-secret-key';
    expect(validateAccessKey('my-secret-key')).toBe(true);
  });

  it('returns false for non-matching key', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'my-secret-key';
    expect(validateAccessKey('wrong-key')).toBe(false);
  });

  it('returns false for empty key when a key is configured', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'my-secret-key';
    expect(validateAccessKey('')).toBe(false);
  });

  it('returns false for key of different length', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'short';
    expect(validateAccessKey('much-longer-key')).toBe(false);
  });

  it('handles special characters', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'key-with-$pecial!chars@123';
    expect(validateAccessKey('key-with-$pecial!chars@123')).toBe(true);
    expect(validateAccessKey('key-with-$pecial!chars@124')).toBe(false);
  });

  it('does not emit any stderr warning when a valid key is configured', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'valid-key';
    validateAccessKey('valid-key');
    validateAccessKey('wrong-key');
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe('createRateLimiter', () => {
  it('should allow requests under the limit', () => {
    const limiter = createRateLimiter(5, 60000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('192.168.1.1')).toBe(true);
    }
  });

  it('should reject requests over the limit', () => {
    const limiter = createRateLimiter(3, 60000);
    expect(limiter.check('192.168.1.1')).toBe(true); // 1
    expect(limiter.check('192.168.1.1')).toBe(true); // 2
    expect(limiter.check('192.168.1.1')).toBe(true); // 3
    expect(limiter.check('192.168.1.1')).toBe(false); // 4 - rejected
  });

  it('should track IPs independently', () => {
    const limiter = createRateLimiter(2, 60000);
    expect(limiter.check('192.168.1.1')).toBe(true);
    expect(limiter.check('192.168.1.1')).toBe(true);
    expect(limiter.check('192.168.1.1')).toBe(false);
    // Different IP should still be allowed
    expect(limiter.check('192.168.1.2')).toBe(true);
  });

  it('should use default values (100 req/min)', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 100; i++) {
      expect(limiter.check('10.0.0.1')).toBe(true);
    }
    expect(limiter.check('10.0.0.1')).toBe(false);
  });

  describe('middleware', () => {
    it('should call next() when under limit', () => {
      const limiter = createRateLimiter(10, 60000);
      const req = { socket: { remoteAddress: '192.168.1.1' } } as IncomingMessage;
      const res = {} as ServerResponse;
      const next = vi.fn();

      limiter.middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should send 429 when over limit', () => {
      const limiter = createRateLimiter(1, 60000);
      const req = { socket: { remoteAddress: '192.168.1.1' } } as IncomingMessage;
      const writeHead = vi.fn();
      const end = vi.fn();
      const res = { writeHead, end } as unknown as ServerResponse;
      const next = vi.fn();

      // First request passes
      limiter.middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Second request gets rate limited
      const next2 = vi.fn();
      limiter.middleware(req, res, next2);
      expect(next2).not.toHaveBeenCalled();
      expect(writeHead).toHaveBeenCalledWith(429, { 'Content-Type': 'application/json' });
      expect(end).toHaveBeenCalled();
    });

    it('should handle missing socket address', () => {
      const limiter = createRateLimiter(10, 60000);
      const req = { socket: {} } as IncomingMessage;
      const res = {} as ServerResponse;
      const next = vi.fn();

      limiter.middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
