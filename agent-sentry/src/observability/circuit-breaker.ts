/**
 * circuit-breaker.ts — Circuit Breaker & Retry with Exponential Backoff (M5 Task 5.2)
 *
 * Provides fault-tolerance primitives: a CircuitBreaker that prevents cascading
 * failures by short-circuiting calls to unhealthy dependencies, and a retry()
 * utility with exponential backoff and jitter.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxAttempts?: number;
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  totalCalls: number;
  totalFailures: number;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryOn?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** Injectable sleep for testing. Defaults to real setTimeout-based promise. */
  sleep?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CircuitOpenError extends Error {
  constructor(message?: string) {
    super(message ?? 'Circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}

// ---------------------------------------------------------------------------
// Default sleep
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private readonly _name: string;
  private readonly _failureThreshold: number;
  private readonly _resetTimeoutMs: number;
  private readonly _halfOpenMaxAttempts: number;
  private readonly _onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;

  private _state: CircuitState = 'closed';
  private _failures = 0;
  private _successes = 0;
  private _halfOpenSuccesses = 0;
  private _lastFailure: number | null = null;
  private _lastSuccess: number | null = null;
  private _totalCalls = 0;
  private _totalFailures = 0;
  private _openedAt: number | null = null;

  constructor(options: CircuitBreakerOptions) {
    this._name = options.name;
    this._failureThreshold = options.failureThreshold ?? 5;
    this._resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this._halfOpenMaxAttempts = options.halfOpenMaxAttempts ?? 2;
    this._onStateChange = options.onStateChange;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  getState(): CircuitState {
    // Check if open state should transition to half-open
    if (this._state === 'open' && this._openedAt !== null) {
      if (Date.now() - this._openedAt >= this._resetTimeoutMs) {
        this._transition('half-open');
      }
    }
    return this._state;
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failures: this._failures,
      successes: this._successes,
      lastFailure: this._lastFailure,
      lastSuccess: this._lastSuccess,
      totalCalls: this._totalCalls,
      totalFailures: this._totalFailures,
    };
  }

  reset(): void {
    this._transition('closed');
    this._failures = 0;
    this._successes = 0;
    this._halfOpenSuccesses = 0;
    this._lastFailure = null;
    this._lastSuccess = null;
    this._totalCalls = 0;
    this._totalFailures = 0;
    this._openedAt = null;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    this._totalCalls++;

    if (state === 'open') {
      throw new CircuitOpenError(
        `Circuit breaker "${this._name}" is open — call rejected`
      );
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure();
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _onSuccess(): void {
    this._successes++;
    this._lastSuccess = Date.now();

    if (this._state === 'half-open') {
      this._halfOpenSuccesses++;
      if (this._halfOpenSuccesses >= this._halfOpenMaxAttempts) {
        this._transition('closed');
        this._failures = 0;
        this._halfOpenSuccesses = 0;
      }
    } else {
      // In closed state, a success resets the consecutive failure count
      this._failures = 0;
    }
  }

  private _onFailure(): void {
    this._failures++;
    this._totalFailures++;
    this._lastFailure = Date.now();

    if (this._state === 'half-open') {
      // Any failure in half-open immediately reopens
      this._halfOpenSuccesses = 0;
      this._transition('open');
    } else if (this._state === 'closed') {
      if (this._failures >= this._failureThreshold) {
        this._transition('open');
      }
    }
  }

  private _transition(to: CircuitState): void {
    if (this._state === to) return;
    const from = this._state;
    this._state = to;

    if (to === 'open') {
      this._openedAt = Date.now();
    } else if (to === 'closed') {
      this._openedAt = null;
    }

    if (this._onStateChange) {
      this._onStateChange(from, to, this._name);
    }
  }
}

// ---------------------------------------------------------------------------
// retry()
// ---------------------------------------------------------------------------

export async function retry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30_000;
  const backoffFactor = options?.backoffFactor ?? 2;
  const retryOn = options?.retryOn;
  const onRetry = options?.onRetry;
  const sleep = options?.sleep ?? defaultSleep;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // If we've exhausted retries, throw
      if (attempt >= maxRetries) {
        throw lastError;
      }

      // If retryOn filter rejects this error, throw immediately
      if (retryOn && !retryOn(lastError)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = baseDelayMs * Math.pow(backoffFactor, attempt);
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, lastError, delay);
      }

      await sleep(delay);
    }
  }

  // Unreachable but satisfies TypeScript
  throw lastError ?? new Error('retry: unexpected state');
}

// ---------------------------------------------------------------------------
// withCircuitBreaker()
// ---------------------------------------------------------------------------

export async function withCircuitBreaker<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  retryOptions?: RetryOptions,
): Promise<T> {
  return retry(
    () => breaker.execute(fn),
    retryOptions,
  );
}
