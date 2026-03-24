/**
 * auth.test.ts — Tests for access key validation and rate limiter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAccessKey, createRateLimiter } from '../../src/mcp/auth';
import { IncomingMessage, ServerResponse } from 'http';

describe('validateAccessKey', () => {
  const originalEnv = process.env.AGENT_SENTRY_ACCESS_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AGENT_SENTRY_ACCESS_KEY;
    } else {
      process.env.AGENT_SENTRY_ACCESS_KEY = originalEnv;
    }
  });

  it('should return true when no key is configured (open access)', () => {
    delete process.env.AGENT_SENTRY_ACCESS_KEY;
    expect(validateAccessKey('anything')).toBe(true);
  });

  it('should return true for matching key', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'my-secret-key';
    expect(validateAccessKey('my-secret-key')).toBe(true);
  });

  it('should return false for non-matching key', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'my-secret-key';
    expect(validateAccessKey('wrong-key')).toBe(false);
  });

  it('should return false for empty key when key is required', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'my-secret-key';
    expect(validateAccessKey('')).toBe(false);
  });

  it('should return false for key of different length', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'short';
    expect(validateAccessKey('much-longer-key')).toBe(false);
  });

  it('should handle special characters', () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'key-with-$pecial!chars@123';
    expect(validateAccessKey('key-with-$pecial!chars@123')).toBe(true);
    expect(validateAccessKey('key-with-$pecial!chars@124')).toBe(false);
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
