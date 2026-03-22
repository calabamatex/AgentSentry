/**
 * connection-pool.ts — HTTP connection pool for Supabase REST API requests.
 *
 * Manages keep-alive http.Agent / https.Agent instances for connection reuse,
 * and provides a PooledSupabaseProvider that delegates StorageProvider methods
 * through pooled HTTP transport.
 */

import * as http from 'http';
import * as https from 'https';
import { StorageProvider } from './storage-provider';
import {
  OpsEvent,
  QueryOptions,
  VectorSearchOptions,
  SearchResult,
  AggregateOptions,
  OpsStats,
  EventType,
  Severity,
  Skill,
  EVENT_TYPES,
  SEVERITIES,
  SKILLS,
} from '../schema';

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

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
      const sockets = (agent as any).sockets ?? {};
      for (const key of Object.keys(sockets)) {
        const count = sockets[key]?.length ?? 0;
        activeConnections += count;
        totalConnections += count;
      }

      // Count free sockets (idle, kept alive)
      const freeSockets = (agent as any).freeSockets ?? {};
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
    const httpOk = this.httpAgent ? !(this.httpAgent as any).destroyed : true;
    const httpsOk = this.httpsAgent
      ? !(this.httpsAgent as any).destroyed
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

// ── PooledSupabaseProvider ───────────────────────────────────────────────────

export interface PooledSupabaseProviderConfig {
  url?: string;
  serviceRoleKey?: string;
  poolOptions?: ConnectionPoolOptions;
}

/**
 * A StorageProvider that mirrors SupabaseProvider's REST API logic but routes
 * all HTTP traffic through a ConnectionPool for keep-alive connection reuse.
 */
export class PooledSupabaseProvider implements StorageProvider {
  readonly name = 'supabase-pooled';
  readonly mode = 'remote' as const;

  private url: string;
  private serviceRoleKey: string;
  private readonly pool: ConnectionPool;

  constructor(config?: PooledSupabaseProviderConfig) {
    this.url = config?.url ?? process.env.SUPABASE_URL ?? '';
    this.serviceRoleKey =
      config?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    this.pool = new ConnectionPool(config?.poolOptions);
  }

  /** Expose the underlying pool for external stats / health checks. */
  getPool(): ConnectionPool {
    return this.pool;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (!this.url || !this.serviceRoleKey) {
      throw new Error(
        'PooledSupabaseProvider requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars or constructor config.',
      );
    }
    this.url = this.url.replace(/\/+$/, '');

    try {
      await this.rpc('ensure_ops_schema', {});
    } catch (err) {
      console.warn(
        'PooledSupabaseProvider: ensure_ops_schema RPC call failed (tables may already exist):',
        err,
      );
    }
  }

  async close(): Promise<void> {
    this.pool.destroy();
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async insert(event: OpsEvent): Promise<void> {
    const body: Record<string, unknown> = {
      id: event.id,
      timestamp: event.timestamp,
      session_id: event.session_id,
      agent_id: event.agent_id,
      event_type: event.event_type,
      severity: event.severity,
      skill: event.skill,
      title: event.title,
      detail: event.detail,
      affected_files: event.affected_files,
      tags: event.tags,
      metadata: event.metadata,
      hash: event.hash,
      prev_hash: event.prev_hash,
    };

    if (event.embedding && event.embedding.length > 0) {
      body.embedding = `[${event.embedding.join(',')}]`;
    }

    await this.request('/rest/v1/ops_events', {
      method: 'POST',
      body,
      headers: { Prefer: 'return=minimal' },
    });
  }

  async getById(id: string): Promise<OpsEvent | null> {
    const rows = await this.request<any[]>(
      `/rest/v1/ops_events?id=eq.${encodeURIComponent(id)}&limit=1`,
      { method: 'GET' },
    );
    if (!rows || rows.length === 0) return null;
    return this.rowToEvent(rows[0]);
  }

  async query(options: QueryOptions): Promise<OpsEvent[]> {
    const params = this.buildQueryParams(options);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    params.push('order=timestamp.desc');
    params.push(`limit=${limit}`);
    params.push(`offset=${offset}`);

    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    const rows = await this.request<any[]>(`/rest/v1/ops_events${qs}`, {
      method: 'GET',
    });
    return (rows || []).map((r: any) => this.rowToEvent(r));
  }

  async count(options: QueryOptions): Promise<number> {
    const params = this.buildQueryParams(options);
    params.push('select=id');
    params.push('limit=0');

    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    const result = await this.request<any>(`/rest/v1/ops_events${qs}`, {
      method: 'GET',
      headers: { Prefer: 'count=exact' },
      returnHeaders: true,
    });
    const contentRange = result.headers?.['content-range'];
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  }

  // ── Vector search ────────────────────────────────────────────────────────

  async vectorSearch(
    embedding: number[],
    options: VectorSearchOptions,
  ): Promise<SearchResult[]> {
    const rpcBody: Record<string, unknown> = {
      query_embedding: `[${embedding.join(',')}]`,
      match_count: options.limit ?? 10,
      match_threshold: options.threshold ?? 0.5,
    };

    if (options.event_type) rpcBody.filter_event_type = options.event_type;
    if (options.severity) rpcBody.filter_severity = options.severity;
    if (options.skill) rpcBody.filter_skill = options.skill;
    if (options.session_id) rpcBody.filter_session_id = options.session_id;
    if (options.since) rpcBody.filter_since = options.since;

    const rows = await this.rpc<any[]>('match_ops_events', rpcBody);
    return (rows || []).map((r: any) => ({
      event: this.rowToEvent(r),
      score: r.similarity,
    }));
  }

  // ── Aggregation ──────────────────────────────────────────────────────────

  async aggregate(options: AggregateOptions): Promise<OpsStats> {
    const baseParams = this.buildAggregateParams(options);

    const total = await this.countWithParams(baseParams);

    const byType: Record<EventType, number> = {} as any;
    for (const t of EVENT_TYPES) {
      byType[t] = await this.countWithParams([
        ...baseParams,
        `event_type=eq.${t}`,
      ]);
    }

    const bySeverity: Record<Severity, number> = {} as any;
    for (const s of SEVERITIES) {
      bySeverity[s] = await this.countWithParams([
        ...baseParams,
        `severity=eq.${s}`,
      ]);
    }

    const bySkill: Record<Skill, number> = {} as any;
    for (const sk of SKILLS) {
      bySkill[sk] = await this.countWithParams([
        ...baseParams,
        `skill=eq.${sk}`,
      ]);
    }

    const firstParams = [
      ...baseParams,
      'select=timestamp',
      'order=timestamp.asc',
      'limit=1',
    ];
    const lastParams = [
      ...baseParams,
      'select=timestamp',
      'order=timestamp.desc',
      'limit=1',
    ];

    const firstRows = await this.request<any[]>(
      `/rest/v1/ops_events?${firstParams.join('&')}`,
      { method: 'GET' },
    );
    const lastRows = await this.request<any[]>(
      `/rest/v1/ops_events?${lastParams.join('&')}`,
      { method: 'GET' },
    );

    return {
      total_events: total,
      by_type: byType,
      by_severity: bySeverity,
      by_skill: bySkill,
      first_event: firstRows?.[0]?.timestamp ?? undefined,
      last_event: lastRows?.[0]?.timestamp ?? undefined,
    };
  }

  // ── Chain ────────────────────────────────────────────────────────────────

  async getChain(since?: string): Promise<OpsEvent[]> {
    const params: string[] = ['order=timestamp.asc'];
    if (since) {
      params.push(`timestamp=gte.${encodeURIComponent(since)}`);
    }
    const qs = params.join('&');
    const rows = await this.request<any[]>(`/rest/v1/ops_events?${qs}`, {
      method: 'GET',
    });
    return (rows || []).map((r: any) => this.rowToEvent(r));
  }

  // ── Prune ────────────────────────────────────────────────────────────────

  async prune(options: {
    maxEvents?: number;
    maxAgeDays?: number;
  }): Promise<{ deleted: number }> {
    let totalDeleted = 0;

    if (options.maxAgeDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.maxAgeDays);
      const cutoffStr = cutoff.toISOString();

      const deleteResult = await this.request<any>(
        `/rest/v1/ops_events?timestamp=lt.${encodeURIComponent(cutoffStr)}`,
        {
          method: 'DELETE',
          headers: { Prefer: 'return=representation' },
        },
      );
      totalDeleted += Array.isArray(deleteResult) ? deleteResult.length : 0;
    }

    if (options.maxEvents) {
      const currentCount = await this.countWithParams([]);
      if (currentCount > options.maxEvents) {
        const excess = currentCount - options.maxEvents;
        const oldestRows = await this.request<any[]>(
          `/rest/v1/ops_events?select=id&order=timestamp.asc&limit=${excess}`,
          { method: 'GET' },
        );
        if (oldestRows && oldestRows.length > 0) {
          const ids = oldestRows.map((r: any) => r.id);
          const idList = ids.map((id: string) => `"${id}"`).join(',');
          const deleteResult = await this.request<any>(
            `/rest/v1/ops_events?id=in.(${idList})`,
            {
              method: 'DELETE',
              headers: { Prefer: 'return=representation' },
            },
          );
          totalDeleted += Array.isArray(deleteResult)
            ? deleteResult.length
            : 0;
        }
      }
    }

    return { deleted: totalDeleted };
  }

  // ── Chain checkpoints ────────────────────────────────────────────────────

  async saveChainCheckpoint(checkpoint: {
    lastEventId: string;
    lastEventHash: string;
    eventsVerified: number;
  }): Promise<void> {
    await this.request('/rest/v1/chain_checkpoints', {
      method: 'POST',
      body: {
        last_event_id: checkpoint.lastEventId,
        last_event_hash: checkpoint.lastEventHash,
        events_verified: checkpoint.eventsVerified,
      },
      headers: { Prefer: 'return=minimal' },
    });
  }

  async getLastChainCheckpoint(): Promise<{
    lastEventId: string;
    lastEventHash: string;
    eventsVerified: number;
    verifiedAt: string;
  } | null> {
    const rows = await this.request<any[]>(
      '/rest/v1/chain_checkpoints?order=id.desc&limit=1',
      { method: 'GET' },
    );
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      lastEventId: row.last_event_id,
      lastEventHash: row.last_event_hash,
      eventsVerified: row.events_verified,
      verifiedAt: row.verified_at,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      returnHeaders?: boolean;
    },
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const parsed = new URL(this.url);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : isHttps
        ? 443
        : 80;

    const reqHeaders: Record<string, string> = {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const reqPath = `${parsed.pathname === '/' ? '' : parsed.pathname}${path}`;
    const agent = this.pool.getAgent(isHttps);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const req = client.request(
        {
          hostname: parsed.hostname,
          port,
          path: reqPath,
          method,
          headers: reqHeaders,
          agent,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on('end', () => {
            const duration = Date.now() - startTime;
            const failed = !!(res.statusCode && res.statusCode >= 400);
            this.pool.recordRequest(duration, failed);

            if (failed) {
              reject(
                new Error(`Supabase API error ${res.statusCode}: ${body}`),
              );
              return;
            }

            if (options.returnHeaders) {
              try {
                const data = body ? JSON.parse(body) : null;
                resolve({ data, headers: res.headers } as unknown as T);
              } catch {
                resolve({ data: null, headers: res.headers } as unknown as T);
              }
              return;
            }

            try {
              resolve(body ? JSON.parse(body) : (null as unknown as T));
            } catch {
              resolve(null as unknown as T);
            }
          });
        },
      );

      req.on('error', (err) => {
        const duration = Date.now() - startTime;
        this.pool.recordRequest(duration, true);
        reject(err);
      });

      if (options.body !== undefined) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }

  private async rpc<T>(
    functionName: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    return this.request<T>(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body,
    });
  }

  private buildQueryParams(options: QueryOptions): string[] {
    const params: string[] = [];
    if (options.event_type) params.push(`event_type=eq.${options.event_type}`);
    if (options.severity) params.push(`severity=eq.${options.severity}`);
    if (options.skill) params.push(`skill=eq.${options.skill}`);
    if (options.since)
      params.push(`timestamp=gte.${encodeURIComponent(options.since)}`);
    if (options.until)
      params.push(`timestamp=lte.${encodeURIComponent(options.until)}`);
    if (options.session_id)
      params.push(`session_id=eq.${encodeURIComponent(options.session_id)}`);
    if (options.agent_id)
      params.push(`agent_id=eq.${encodeURIComponent(options.agent_id)}`);
    if (options.tag) params.push(`tags=cs.["${options.tag}"]`);
    return params;
  }

  private buildAggregateParams(options: AggregateOptions): string[] {
    const params: string[] = [];
    if (options.since)
      params.push(`timestamp=gte.${encodeURIComponent(options.since)}`);
    if (options.until)
      params.push(`timestamp=lte.${encodeURIComponent(options.until)}`);
    if (options.session_id)
      params.push(`session_id=eq.${encodeURIComponent(options.session_id)}`);
    return params;
  }

  private async countWithParams(params: string[]): Promise<number> {
    const allParams = [...params, 'select=id', 'limit=0'];
    const qs = allParams.join('&');
    const result = await this.request<any>(`/rest/v1/ops_events?${qs}`, {
      method: 'GET',
      headers: { Prefer: 'count=exact' },
      returnHeaders: true,
    });
    const contentRange = result.headers?.['content-range'];
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  }

  private rowToEvent(row: any): OpsEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      session_id: row.session_id,
      agent_id: row.agent_id,
      event_type: row.event_type,
      severity: row.severity,
      skill: row.skill,
      title: row.title,
      detail: row.detail,
      affected_files:
        typeof row.affected_files === 'string'
          ? safeJsonParse<string[]>(row.affected_files, [])
          : row.affected_files,
      tags:
        typeof row.tags === 'string' ? safeJsonParse<string[]>(row.tags, []) : row.tags,
      metadata:
        typeof row.metadata === 'string'
          ? safeJsonParse<Record<string, unknown>>(row.metadata, {})
          : row.metadata,
      hash: row.hash,
      prev_hash: row.prev_hash,
    };
  }
}
