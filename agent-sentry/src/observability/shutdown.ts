/**
 * shutdown.ts — Graceful shutdown handler with priority-ordered cleanup.
 * Zero external dependencies.
 */

/** Options for configuring the ShutdownManager. */
export interface ShutdownOptions {
  /** Force kill timeout in milliseconds (default: 10000). */
  timeoutMs?: number;
  /** Called when shutdown starts. */
  onShutdown?: () => void;
  /** Signals to listen for (default: ['SIGTERM', 'SIGINT']). */
  signals?: string[];
}

/** Result for an individual shutdown handler. */
export interface HandlerResult {
  name: string;
  status: 'success' | 'failed' | 'timeout';
  durationMs: number;
  error?: string;
}

/** Report produced after the shutdown sequence completes. */
export interface ShutdownReport {
  reason: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  results: HandlerResult[];
  clean: boolean;
}

interface RegisteredHandler {
  name: string;
  handler: () => Promise<void>;
  priority: number;
}

/**
 * Manages an ordered set of async shutdown handlers.
 *
 * Does NOT call process.exit() or attach signal listeners itself.
 * Signal listening is the caller's responsibility, keeping the class testable.
 */
export class ShutdownManager {
  private readonly _timeoutMs: number;
  private readonly _onShutdown?: () => void;
  private readonly _signals: string[];
  private _handlers: RegisteredHandler[] = [];
  private _shuttingDown = false;
  private _report: ShutdownReport | null = null;

  constructor(options: ShutdownOptions = {}) {
    this._timeoutMs = options.timeoutMs ?? 10_000;
    this._onShutdown = options.onShutdown;
    this._signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  }

  /** The signals this manager was configured with. */
  get signals(): string[] {
    return [...this._signals];
  }

  /** Register a named shutdown handler with an optional priority (lower runs first). */
  register(name: string, handler: () => Promise<void>, priority = 10): void {
    if (this._shuttingDown) {
      return;
    }
    // Replace if same name already registered
    this._handlers = this._handlers.filter(h => h.name !== name);
    this._handlers.push({ name, handler, priority });
  }

  /** Remove a registered handler by name. */
  deregister(name: string): void {
    this._handlers = this._handlers.filter(h => h.name !== name);
  }

  /** List the names of all registered handlers. */
  getRegistered(): string[] {
    return this._handlers.map(h => h.name);
  }

  /** Whether the manager is currently shutting down or has shut down. */
  isShuttingDown(): boolean {
    return this._shuttingDown;
  }

  /**
   * Execute the shutdown sequence.
   *
   * Handlers run sequentially in priority order (lowest number first).
   * Each handler receives an equal share of the total timeout budget.
   * The call is idempotent: a second invocation returns the original report.
   */
  async shutdown(reason?: string): Promise<ShutdownReport> {
    if (this._report) {
      return this._report;
    }

    this._shuttingDown = true;
    const startedAt = new Date();

    if (this._onShutdown) {
      this._onShutdown();
    }

    // Sort by priority (ascending)
    const sorted = [...this._handlers].sort((a, b) => a.priority - b.priority);
    const perHandlerTimeout =
      sorted.length > 0 ? Math.floor(this._timeoutMs / sorted.length) : 0;

    const results: HandlerResult[] = [];

    for (const entry of sorted) {
      const handlerStart = Date.now();
      try {
        await withTimeout(entry.handler(), perHandlerTimeout);
        results.push({
          name: entry.name,
          status: 'success',
          durationMs: Date.now() - handlerStart,
        });
      } catch (err: unknown) {
        const isTimeout = err instanceof TimeoutError;
        results.push({
          name: entry.name,
          status: isTimeout ? 'timeout' : 'failed',
          durationMs: Date.now() - handlerStart,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const completedAt = new Date();
    this._report = {
      reason: reason ?? 'unknown',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      results,
      clean: results.every(r => r.status === 'success'),
    };

    return this._report;
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns a function suitable for use as a signal handler
 * (e.g. `process.on('SIGTERM', createShutdownHandler(manager))`).
 *
 * Does NOT call process.exit() — leaves that to the caller.
 */
export function createShutdownHandler(
  manager: ShutdownManager,
): (signal: string) => void {
  return (signal: string) => {
    void manager.shutdown(signal).then(report => {
      // Log the report to stderr as a JSON line
      const line = JSON.stringify(report);
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(line + '\n');
      }
    }).catch((err) => {
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`Shutdown error: ${err}\n`);
      }
    });
  };
}

/* ------------------------------------------------------------------ */
/*  Common shutdown handler factories                                  */
/* ------------------------------------------------------------------ */

/**
 * Creates a shutdown handler that closes an HTTP server.
 */
export function httpServerShutdown(
  server: { close: (cb?: (err?: Error) => void) => void },
): () => Promise<void> {
  return () =>
    new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
}

/**
 * Creates a shutdown handler that clears an interval timer.
 */
export function intervalShutdown(
  interval: ReturnType<typeof setInterval>,
): () => Promise<void> {
  return async () => {
    clearInterval(interval);
  };
}

/**
 * Wraps an arbitrary async function as a shutdown handler.
 */
export function customShutdown(fn: () => Promise<void>): () => Promise<void> {
  return fn;
}

/* ------------------------------------------------------------------ */
/*  Internal timeout helper                                            */
/* ------------------------------------------------------------------ */

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Handler timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(ms));
    }, ms);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
