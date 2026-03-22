/**
 * connection-pool.ts — HTTP connection pool for Supabase REST API requests.
 *
 * Manages keep-alive http.Agent / https.Agent instances for connection reuse.
 * The PooledSupabaseProvider that uses this pool is in pooled-supabase-provider.ts.
 */

import * as http from 'http';
import * as https from 'https';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ConnectionPoolOptions {
  maxConnections?: number;
  idleTimeout?: number;
  healthCheckInterval?: number;
  keepAlive?: boolean;
  keepAliveMsecs?: number;
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  totalRequests: number;
  failedRequests: number;
  avgResponseTime: number;
}

// ── ConnectionPool ───────────────────────────────────────────────────────────

export class ConnectionPool {
  private readonly maxConnections: number;
  private readonly idleTimeout: number;
  private readonly healthCheckInterval: number;
  private readonly keepAlive: boolean;
  private readonly keepAliveMsecs: number;

  private httpAgent: http.Agent | null = null;
  private httpsAgent: https.Agent | null = null;
  private destroyed = false;

  private totalRequests = 0;
  private failedRequests = 0;
  private totalResponseTime = 0;

  constructor(options?: ConnectionPoolOptions) {
    this.maxConnections = options?.maxConnections ?? 10;
    this.idleTimeout = options?.idleTimeout ?? 30000;
    this.healthCheckInterval = options?.healthCheckInterval ?? 60000;
    this.keepAlive = options?.keepAlive ?? true;
    this.keepAliveMsecs = options?.keepAliveMsecs ?? 1000;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Returns a keep-alive Agent for the given protocol. Creates one lazily
   * on first call.
   */
  getAgent(isHttps: boolean): http.Agent | https.Agent {
    if (this.destroyed) {
      throw new Error('ConnectionPool has been destroyed');
    }

    if (isHttps) {
      if (!this.httpsAgent) {
        this.httpsAgent = new https.Agent({
          keepAlive: this.keepAlive,
          keepAliveMsecs: this.keepAliveMsecs,
          maxSockets: this.maxConnections,
          timeout: this.idleTimeout,
        });
      }
      return this.httpsAgent;
    }

    if (!this.httpAgent) {
      this.httpAgent = new http.Agent({
        keepAlive: this.keepAlive,
        keepAliveMsecs: this.keepAliveMsecs,
        maxSockets: this.maxConnections,
        timeout: this.idleTimeout,
      });
    }
    return this.httpAgent;
  }

  /**
   * Returns current pool statistics derived from the underlying agents.
   */
  stats(): PoolStats {
    let totalConnections = 0;
    let activeConnections = 0;
    let idleConnections = 0;

    for (const agent of [this.httpAgent, this.httpsAgent]) {
      if (!agent) continue;

      // Count active sockets (in-use)
      const agentWithInternals = agent as unknown as { sockets?: Record<string, unknown[]>; freeSockets?: Record<string, unknown[]>; destroyed?: boolean };
      const sockets = agentWithInternals.sockets ?? {};
      for (const key of Object.keys(sockets)) {
        const count = sockets[key]?.length ?? 0;
        activeConnections += count;
        totalConnections += count;
      }

      // Count free sockets (idle, kept alive)
      const freeSockets = agentWithInternals.freeSockets ?? {};
      for (const key of Object.keys(freeSockets)) {
        const count = freeSockets[key]?.length ?? 0;
        idleConnections += count;
        totalConnections += count;
      }
    }

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      totalRequests: this.totalRequests,
      failedRequests: this.failedRequests,
      avgResponseTime:
        this.totalRequests > 0
          ? this.totalResponseTime / this.totalRequests
          : 0,
    };
  }

  /**
   * Records a completed request for metrics tracking.
   */
  recordRequest(duration: number, failed: boolean): void {
    this.totalRequests++;
    this.totalResponseTime += duration;
    if (failed) {
      this.failedRequests++;
    }
  }

  /**
   * Returns true if the pool is healthy — agents exist and have not been
   * destroyed. This is a synchronous check; callers invoke it on their own
   * schedule (no background timer).
   */
  async healthCheck(): Promise<boolean> {
    if (this.destroyed) return false;

    // Pool is healthy if at least one agent exists and is not destroyed
    const httpOk = this.httpAgent ? !(this.httpAgent as unknown as { destroyed?: boolean }).destroyed : true;
    const httpsOk = this.httpsAgent
      ? !(this.httpsAgent as unknown as { destroyed?: boolean }).destroyed
      : true;

    return httpOk && httpsOk;
  }

  /**
   * Destroys all agents and resets statistics.
   */
  destroy(): void {
    if (this.httpAgent) {
      this.httpAgent.destroy();
      this.httpAgent = null;
    }
    if (this.httpsAgent) {
      this.httpsAgent.destroy();
      this.httpsAgent = null;
    }
    this.destroyed = true;
    this.totalRequests = 0;
    this.failedRequests = 0;
    this.totalResponseTime = 0;
  }
}
