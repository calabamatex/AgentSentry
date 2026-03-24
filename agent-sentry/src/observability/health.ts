/**
 * health.ts — Health and readiness endpoints for observability.
 * Zero external dependencies — uses only Node built-in http and perf_hooks.
 */

import type { IncomingMessage, ServerResponse } from 'http';

/** Result of a single component health check. */
export interface ComponentCheck {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  latencyMs?: number;
  lastChecked?: string;
}

/** Aggregated health check result across all registered components. */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, ComponentCheck>;
  version: string;
  uptime: number;
  timestamp: string;
}

/** Liveness probe response. */
export interface LivenessResult {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

/** Options for constructing a HealthChecker. */
export interface HealthCheckerOptions {
  version?: string;
}

/** Checker function type — returns a ComponentCheck promise. */
export type CheckerFn = () => Promise<ComponentCheck>;

/**
 * HealthChecker manages named health checks and produces liveness/readiness results.
 *
 * - liveness() always returns ok if the process is running.
 * - readiness() runs all registered checks and aggregates their statuses.
 */
export class HealthChecker {
  private readonly _version: string;
  private readonly _startedAt: number;
  private readonly _checks: Map<string, CheckerFn> = new Map();

  constructor(options?: HealthCheckerOptions) {
    this._version = options?.version ?? '0.0.0';
    this._startedAt = Date.now();
  }

  /** Register a named health check function. */
  registerCheck(name: string, checker: CheckerFn): void {
    this._checks.set(name, checker);
  }

  /** Remove a previously registered check by name. */
  removeCheck(name: string): void {
    this._checks.delete(name);
  }

  /** Return the list of registered check names. */
  getRegisteredChecks(): string[] {
    return Array.from(this._checks.keys());
  }

  /** Return seconds elapsed since construction. */
  getUptime(): number {
    return (Date.now() - this._startedAt) / 1000;
  }

  /** Simple liveness probe — always ok if the process is running. */
  async liveness(): Promise<LivenessResult> {
    return {
      status: 'ok',
      uptime: this.getUptime(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe — runs every registered check and aggregates results.
   *
   * Overall status logic:
   *   - All pass  -> healthy
   *   - Any warn (no fail) -> degraded
   *   - Any fail  -> unhealthy
   */
  async readiness(): Promise<HealthCheckResult> {
    const checks: Record<string, ComponentCheck> = {};
    const entries = Array.from(this._checks.entries());

    const results = await Promise.allSettled(
      entries.map(async ([name, checker]) => {
        const start = Date.now();
        try {
          const result = await checker();
          result.latencyMs = Date.now() - start;
          result.lastChecked = new Date().toISOString();
          checks[name] = result;
        } catch (err) {
          checks[name] = {
            status: 'fail',
            message: err instanceof Error ? err.message : String(err),
            latencyMs: Date.now() - start,
            lastChecked: new Date().toISOString(),
          };
        }
      }),
    );

    // Suppress unused-variable warning — allSettled is used for await semantics
    void results;

    let status: HealthCheckResult['status'] = 'healthy';
    for (const check of Object.values(checks)) {
      if (check.status === 'fail') {
        status = 'unhealthy';
        break;
      }
      if (check.status === 'warn') {
        status = 'degraded';
      }
    }

    return {
      status,
      checks,
      version: this._version,
      uptime: this.getUptime(),
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Creates an HTTP middleware that handles /healthz and /readyz routes.
 *
 * Returns `true` if the request was handled, `false` if the URL did not match
 * (allowing pass-through to downstream handlers).
 */
export function createHealthMiddleware(
  checker: HealthChecker,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  // We return a synchronous boolean but kick off the async work internally.
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = req.url ?? '';
    const method = req.method ?? '';

    if (method !== 'GET') {
      return false;
    }

    if (url === '/healthz') {
      void checker.liveness().then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return true;
    }

    if (url === '/readyz') {
      void checker.readiness().then((result) => {
        const code = result.status === 'unhealthy' ? 503 : 200;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return true;
    }

    return false;
  };
}

/**
 * Factory: creates a checker for memory usage.
 *
 * - pass if heapUsed < 80% of threshold
 * - warn if heapUsed >= 80% of threshold but < threshold
 * - fail if heapUsed >= threshold
 *
 * @param thresholdMb Maximum heap usage in MB (default 512).
 */
export function memoryUsageCheck(thresholdMb = 512): () => Promise<ComponentCheck> {
  return async (): Promise<ComponentCheck> => {
    const { heapUsed } = process.memoryUsage();
    const usedMb = heapUsed / (1024 * 1024);
    const warnThreshold = thresholdMb * 0.8;

    if (usedMb >= thresholdMb) {
      return {
        status: 'fail',
        message: `Heap usage ${usedMb.toFixed(1)}MB exceeds ${thresholdMb}MB threshold`,
      };
    }
    if (usedMb >= warnThreshold) {
      return {
        status: 'warn',
        message: `Heap usage ${usedMb.toFixed(1)}MB exceeds 80% of ${thresholdMb}MB threshold`,
      };
    }
    return {
      status: 'pass',
      message: `Heap usage ${usedMb.toFixed(1)}MB within limits`,
    };
  };
}

/**
 * Factory: creates a checker for event loop delay.
 *
 * Measures event loop delay by scheduling a timer and comparing actual vs expected elapsed time.
 *
 * - pass if delay < 50ms
 * - warn if delay >= 50ms but < threshold
 * - fail if delay >= threshold
 *
 * @param thresholdMs Maximum acceptable event loop delay in ms (default 100).
 */
export function eventLoopCheck(thresholdMs = 100): () => Promise<ComponentCheck> {
  return (): Promise<ComponentCheck> => {
    return new Promise((resolve) => {
      const start = Date.now();
      // Schedule on the next tick to measure event loop latency
      setTimeout(() => {
        const delayMs = Date.now() - start;

        if (delayMs >= thresholdMs) {
          resolve({
            status: 'fail',
            message: `Event loop delay ${delayMs}ms exceeds ${thresholdMs}ms threshold`,
          });
        } else if (delayMs >= 50) {
          resolve({
            status: 'warn',
            message: `Event loop delay ${delayMs}ms exceeds 50ms warning threshold`,
          });
        } else {
          resolve({
            status: 'pass',
            message: `Event loop delay ${delayMs}ms within limits`,
          });
        }
      }, 0);
    });
  };
}
