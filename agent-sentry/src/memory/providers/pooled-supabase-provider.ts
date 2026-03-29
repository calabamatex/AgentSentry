/**
 * pooled-supabase-provider.ts — Supabase storage provider with connection pooling.
 *
 * Routes all HTTP traffic through a ConnectionPool for keep-alive connection reuse.
 * Functionally equivalent to SupabaseProvider but with better connection management.
 */

import * as https from 'https';
import * as http from 'http';
import { SupabaseBaseProvider, SupabaseRequestOptions } from './supabase-base';
import { ConnectionPool, ConnectionPoolOptions } from './connection-pool';
import { Logger } from '../../observability/logger';
import { errorMessage } from '../../utils/error-message';
import { OpsEvent } from '../schema';

const logger = new Logger({ module: 'connection-pool' });

export interface PooledSupabaseProviderConfig {
  url?: string;
  serviceRoleKey?: string;
  poolOptions?: ConnectionPoolOptions;
}

/**
 * A StorageProvider that mirrors SupabaseProvider's REST API logic but routes
 * all HTTP traffic through a ConnectionPool for keep-alive connection reuse.
 */
export class PooledSupabaseProvider extends SupabaseBaseProvider {
  readonly name = 'supabase-pooled';
  readonly mode = 'remote' as const;

  private readonly pool: ConnectionPool;

  constructor(config?: PooledSupabaseProviderConfig) {
    super(
      config?.url ?? process.env.SUPABASE_URL ?? '',
      config?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    );
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
      logger.warn('PooledSupabaseProvider: ensure_ops_schema RPC call failed (tables may already exist)', { error: errorMessage(err) });
    }
  }

  async close(): Promise<void> {
    this.pool.destroy();
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async insert(event: OpsEvent): Promise<void> {
    const body = this.buildInsertBody(event);
    await this.request('/rest/v1/ops_events', {
      method: 'POST',
      body,
      headers: { Prefer: 'return=minimal' },
    });
  }

  async getById(id: string): Promise<OpsEvent | null> {
    const rows = await this.request<Record<string, unknown>[]>(
      `/rest/v1/ops_events?id=eq.${encodeURIComponent(id)}&limit=1`,
      { method: 'GET' },
    );
    if (!rows || rows.length === 0) return null;
    return this.rowToEvent(rows[0]);
  }

  // ── Pooled HTTP transport ───────────────────────────────────────────────

  protected async request<T>(
    path: string,
    options: SupabaseRequestOptions,
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
              } catch (e) {
                logger.debug('Failed to parse response body with headers', { error: errorMessage(e) });
                resolve({ data: null, headers: res.headers } as unknown as T);
              }
              return;
            }

            try {
              resolve(body ? JSON.parse(body) : (null as unknown as T));
            } catch (e) {
              logger.debug('Failed to parse response body', { error: errorMessage(e) });
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
}
