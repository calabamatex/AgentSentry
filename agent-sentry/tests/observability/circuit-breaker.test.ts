import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOptions,
  CircuitState,
  CircuitOpenError,
  retry,
  RetryOptions,
  withCircuitBreaker,
} from '../../src/observability/circuit-breaker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fail = () => Promise.reject(new Error('boom'));
const succeed = () => Promise.resolve('ok');
const fakeSleep = vi.fn((_ms: number) => Promise.resolve());

function makeBreaker(overrides: Partial<CircuitBreakerOptions> = {}): CircuitBreaker {
  return new CircuitBreaker({
    name: overrides.name ?? 'test',
    failureThreshold: overrides.failureThreshold ?? 3,
    resetTimeoutMs: overrides.resetTimeoutMs ?? 5000,
    halfOpenMaxAttempts: overrides.halfOpenMaxAttempts ?? 2,
    onStateChange: overrides.onStateChange,
  });
}

async function failN(breaker: CircuitBreaker, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    try {
      await breaker.execute(fail);
    } catch {
      // expected
    }
  }
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = makeBreaker();
  });

  // -- Closed state ---------------------------------------------------------

  it('starts in closed state', () => {
    expect(breaker.getState()).toBe('closed');
  });

  it('passes through calls in closed state', async () => {
    const result = await breaker.execute(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('propagates errors in closed state without opening below threshold', async () => {
    await failN(breaker, 2);
    expect(breaker.getState()).toBe('closed');
  });

  // -- Closed -> Open -------------------------------------------------------

  it('transitions to open after failure threshold', async () => {
    await failN(breaker, 3);
    expect(breaker.getState()).toBe('open');
  });

  it('resets failure count on success in closed state', async () => {
    await failN(breaker, 2);
    await breaker.execute(succeed);
    await failN(breaker, 2);
    // 2 failures, success (reset), 2 more failures = still closed
    expect(breaker.getState()).toBe('closed');
  });

  // -- Open state -----------------------------------------------------------

  it('rejects calls immediately when open', async () => {
    await failN(breaker, 3);
    await expect(breaker.execute(succeed)).rejects.toThrow(CircuitOpenError);
  });

  it('throws CircuitOpenError with correct name property', async () => {
    await failN(breaker, 3);
    try {
      await breaker.execute(succeed);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).name).toBe('CircuitOpenError');
    }
  });

  it('does not call fn when open', async () => {
    await failN(breaker, 3);
    const fn = vi.fn(() => Promise.resolve('nope'));
    try { await breaker.execute(fn); } catch { /* expected */ }
    expect(fn).not.toHaveBeenCalled();
  });

  // -- Open -> Half-open (with fake timers) ---------------------------------

  it('transitions to half-open after resetTimeout', async () => {
    vi.useFakeTimers();
    try {
      await failN(breaker, 3);
      expect(breaker.getState()).toBe('open');

      vi.advanceTimersByTime(5000);
      expect(breaker.getState()).toBe('half-open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays open if resetTimeout has not elapsed', async () => {
    vi.useFakeTimers();
    try {
      await failN(breaker, 3);
      vi.advanceTimersByTime(3000);
      expect(breaker.getState()).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });

  // -- Half-open -> Closed --------------------------------------------------

  it('transitions half-open to closed after success threshold', async () => {
    vi.useFakeTimers();
    try {
      await failN(breaker, 3);
      vi.advanceTimersByTime(5000);
      expect(breaker.getState()).toBe('half-open');

      await breaker.execute(succeed);
      await breaker.execute(succeed);
      expect(breaker.getState()).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  // -- Half-open -> Open ----------------------------------------------------

  it('reopens on failure in half-open state', async () => {
    vi.useFakeTimers();
    try {
      await failN(breaker, 3);
      vi.advanceTimersByTime(5000);
      expect(breaker.getState()).toBe('half-open');

      await expect(breaker.execute(fail)).rejects.toThrow();
      expect(breaker.getState()).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });

  // -- onStateChange callback -----------------------------------------------

  it('invokes onStateChange callback on transitions', async () => {
    const changes: Array<{ from: CircuitState; to: CircuitState; name: string }> = [];
    const cb = makeBreaker({
      onStateChange: (from, to, name) => changes.push({ from, to, name }),
    });

    await failN(cb, 3);
    expect(changes).toEqual([{ from: 'closed', to: 'open', name: 'test' }]);
  });

  // -- reset() --------------------------------------------------------------

  it('reset() returns breaker to initial state', async () => {
    await failN(breaker, 3);
    expect(breaker.getState()).toBe('open');

    breaker.reset();
    expect(breaker.getState()).toBe('closed');

    const stats = breaker.getStats();
    expect(stats.failures).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.totalCalls).toBe(0);
    expect(stats.totalFailures).toBe(0);
    expect(stats.lastFailure).toBeNull();
    expect(stats.lastSuccess).toBeNull();
  });

  // -- getStats() -----------------------------------------------------------

  it('tracks stats accurately', async () => {
    await breaker.execute(succeed);
    await breaker.execute(succeed);
    await failN(breaker, 1);

    const stats = breaker.getStats();
    expect(stats.state).toBe('closed');
    expect(stats.successes).toBe(2);
    expect(stats.failures).toBe(1);
    expect(stats.totalCalls).toBe(3);
    expect(stats.totalFailures).toBe(1);
    expect(stats.lastSuccess).toBeTypeOf('number');
    expect(stats.lastFailure).toBeTypeOf('number');
  });

  it('totalCalls includes rejected calls when open', async () => {
    await failN(breaker, 3);
    try { await breaker.execute(succeed); } catch { /* expected */ }
    expect(breaker.getStats().totalCalls).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// retry()
// ---------------------------------------------------------------------------

describe('retry()', () => {
  beforeEach(() => {
    fakeSleep.mockClear();
  });

  it('returns result on immediate success', async () => {
    const result = await retry(succeed, { sleep: fakeSleep });
    expect(result).toBe('ok');
    expect(fakeSleep).not.toHaveBeenCalled();
  });

  it('retries and succeeds on eventual success', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 3) return Promise.reject(new Error('not yet'));
      return Promise.resolve('done');
    };

    const result = await retry(fn, { sleep: fakeSleep });
    expect(result).toBe('done');
    expect(calls).toBe(3);
    expect(fakeSleep).toHaveBeenCalledTimes(2);
  });

  it('throws last error after exhausting retries', async () => {
    let attempt = 0;
    const fn = () => {
      attempt++;
      return Promise.reject(new Error(`fail-${attempt}`));
    };

    await expect(retry(fn, { maxRetries: 2, sleep: fakeSleep })).rejects.toThrow('fail-3');
  });

  it('uses exponential backoff with jitter', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const fn = vi.fn(() => Promise.reject(new Error('fail')));
      await retry(fn, {
        maxRetries: 3,
        baseDelayMs: 100,
        backoffFactor: 2,
        maxDelayMs: 50000,
        sleep: fakeSleep,
      }).catch(() => { /* expected */ });

      // attempt 0: 100 * 2^0 + 0.5*100 = 150
      // attempt 1: 100 * 2^1 + 0.5*100 = 250
      // attempt 2: 100 * 2^2 + 0.5*100 = 450
      expect(fakeSleep).toHaveBeenCalledTimes(3);
      expect(fakeSleep.mock.calls[0]![0]).toBeCloseTo(150, 0);
      expect(fakeSleep.mock.calls[1]![0]).toBeCloseTo(250, 0);
      expect(fakeSleep.mock.calls[2]![0]).toBeCloseTo(450, 0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('caps delay at maxDelayMs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const fn = vi.fn(() => Promise.reject(new Error('fail')));
      await retry(fn, {
        maxRetries: 3,
        baseDelayMs: 1000,
        backoffFactor: 10,
        maxDelayMs: 5000,
        sleep: fakeSleep,
      }).catch(() => { /* expected */ });

      // attempt 0: min(1000 * 10^0 + 0, 5000) = 1000
      // attempt 1: min(1000 * 10^1 + 0, 5000) = 5000 (capped)
      // attempt 2: min(1000 * 10^2 + 0, 5000) = 5000 (capped)
      expect(fakeSleep.mock.calls[1]![0]).toBe(5000);
      expect(fakeSleep.mock.calls[2]![0]).toBe(5000);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('respects retryOn filter — skips retry when filter returns false', async () => {
    const fn = () => Promise.reject(new Error('fatal'));
    await expect(
      retry(fn, {
        maxRetries: 3,
        retryOn: () => false,
        sleep: fakeSleep,
      })
    ).rejects.toThrow('fatal');

    expect(fakeSleep).not.toHaveBeenCalled();
  });

  it('respects retryOn filter — retries when filter returns true', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('transient'));
      return Promise.resolve('recovered');
    };

    const result = await retry(fn, {
      retryOn: (err) => err.message === 'transient',
      sleep: fakeSleep,
    });
    expect(result).toBe('recovered');
  });

  it('calls onRetry callback with correct arguments', async () => {
    const onRetry = vi.fn();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      let calls = 0;
      const fn = () => {
        calls++;
        if (calls < 2) return Promise.reject(new Error('oops'));
        return Promise.resolve('ok');
      };

      await retry(fn, { baseDelayMs: 100, onRetry, sleep: fakeSleep });
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('jitter adds randomness to delays', async () => {
    // Run two retries with different random values and verify different delays
    const delays1: number[] = [];
    const delays2: number[] = [];
    const sleep1 = vi.fn((ms: number) => { delays1.push(ms); return Promise.resolve(); });
    const sleep2 = vi.fn((ms: number) => { delays2.push(ms); return Promise.resolve(); });
    const alwaysFail = () => Promise.reject(new Error('fail'));

    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    await retry(alwaysFail, { maxRetries: 1, baseDelayMs: 1000, sleep: sleep1 }).catch(() => {});

    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    await retry(alwaysFail, { maxRetries: 1, baseDelayMs: 1000, sleep: sleep2 }).catch(() => {});

    vi.restoreAllMocks();

    // With different random values, delays should differ
    expect(delays1[0]).not.toBe(delays2[0]);
  });

  it('defaults to 3 retries', async () => {
    let calls = 0;
    const fn = () => { calls++; return Promise.reject(new Error('fail')); };
    await retry(fn, { sleep: fakeSleep }).catch(() => {});
    // 1 initial + 3 retries = 4
    expect(calls).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// withCircuitBreaker()
// ---------------------------------------------------------------------------

describe('withCircuitBreaker()', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = makeBreaker({ failureThreshold: 3 });
    fakeSleep.mockClear();
  });

  it('passes through successful calls', async () => {
    const result = await withCircuitBreaker(breaker, succeed, { sleep: fakeSleep });
    expect(result).toBe('ok');
  });

  it('retries transient failures through the breaker', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('transient'));
      return Promise.resolve('recovered');
    };

    const result = await withCircuitBreaker(breaker, fn, {
      maxRetries: 2,
      sleep: fakeSleep,
    });
    expect(result).toBe('recovered');
  });

  it('opens circuit after enough failures through retries', async () => {
    await expect(
      withCircuitBreaker(breaker, fail, { maxRetries: 3, sleep: fakeSleep })
    ).rejects.toThrow();

    // 1 initial + 3 retries = 4 calls through breaker, threshold is 3
    expect(breaker.getState()).toBe('open');
  });

  it('stops retrying once circuit opens', async () => {
    // Use a breaker with threshold 2 and maxRetries 5
    const tightBreaker = makeBreaker({ failureThreshold: 2 });
    let callCount = 0;
    const fn = () => { callCount++; return Promise.reject(new Error('fail')); };

    await expect(
      withCircuitBreaker(tightBreaker, fn, {
        maxRetries: 5,
        sleep: fakeSleep,
        retryOn: (err) => !(err instanceof CircuitOpenError),
      })
    ).rejects.toThrow(CircuitOpenError);

    // 2 real calls (to trigger open), then next attempt gets CircuitOpenError
    // and retryOn returns false, so it stops
    expect(callCount).toBe(2);
  });
});
