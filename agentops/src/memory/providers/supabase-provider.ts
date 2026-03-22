/**
 * supabase-provider.ts — Supabase (PostgREST) storage backend for AgentOps memory store.
 *
 * Uses raw HTTPS requests against the Supabase REST API — no @supabase/supabase-js dependency.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars (or constructor config).
 */

import * as https from 'https';
import * as http from 'http';
import { SupabaseBaseProvider, SupabaseRequestOptions } from './supabase-base';
import { Logger } from '../../observability/logger';
import { OpsEvent, QueryOptions } from '../schema';

const logger = new Logger({ module: 'supabase-provider' });

export interface SupabaseProviderConfig {
  url?: string;
  serviceRoleKey?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SupabaseProvider extends SupabaseBaseProvider {
  readonly name = 'supabase';
  readonly mode = 'remote' as const;

  constructor(config?: SupabaseProviderConfig) {
    super(
      config?.url ?? process.env.SUPABASE_URL ?? '',
      config?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    );
  }

  async initialize(): Promise<void> {
    if (!this.url || !this.serviceRoleKey) {
      throw new Error(
        'SupabaseProvider requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars or constructor config.',
      );
    }
    // Remove trailing slash from URL
    this.url = this.url.replace(/\/+$/, '');

    // Call ensure_ops_schema RPC to verify connectivity and schema
    try {
      await this.rpc('ensure_ops_schema', {});
    } catch (err) {
      // Tables may already exist or RPC may not be deployed yet — warn but don't throw
      console.warn('SupabaseProvider: ensure_ops_schema RPC call failed (tables may already exist):', err);
    }
  }

  async close(): Promise<void> {
    // No persistent connection to close for HTTP-based provider
  }

  async insert(event: OpsEvent): Promise<void> {
    const body = this.buildInsertBody(event);
    await this.request('/rest/v1/ops_events', {
      method: 'POST',
      body,
      headers: { 'Prefer': 'return=minimal' },
    });
  }

  async getById(id: string): Promise<OpsEvent | null> {
    const rows = await this.request<Record<string, unknown>[]>(`/rest/v1/ops_events?id=eq.${encodeURIComponent(id)}&limit=1`, {
      method: 'GET',
    });
    if (!rows || rows.length === 0) return null;
    return this.rowToEvent(rows[0]);
  }

  async textSearch(query: string, options: QueryOptions): Promise<OpsEvent[]> {
    const encodedQuery = encodeURIComponent(`%${query}%`);
    const params: string[] = [
      `or=(title.ilike.${encodedQuery},detail.ilike.${encodedQuery})`,
    ];

    if (options.event_type) params.push(`event_type=eq.${options.event_type}`);
    if (options.severity) params.push(`severity=eq.${options.severity}`);
    if (options.skill) params.push(`skill=eq.${options.skill}`);
    if (options.since) params.push(`timestamp=gte.${encodeURIComponent(options.since)}`);
    if (options.until) params.push(`timestamp=lte.${encodeURIComponent(options.until)}`);
    if (options.session_id) params.push(`session_id=eq.${encodeURIComponent(options.session_id)}`);
    if (options.agent_id) params.push(`agent_id=eq.${encodeURIComponent(options.agent_id)}`);

    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;
    params.push(`order=timestamp.desc`);
    params.push(`limit=${limit}`);
    params.push(`offset=${offset}`);

    const qs = params.join('&');
    const rows = await this.request<Record<string, unknown>[]>(`/rest/v1/ops_events?${qs}`, { method: 'GET' });
    return (rows || []).map((r) => this.rowToEvent(r));
  }

  // ── UUID validation for prune ───────────────────────────────────────────

  protected override filterValidIds(ids: string[]): string[] {
    return ids.filter((id: string) => UUID_REGEX.test(id));
  }

  // ── HTTP transport ──────────────────────────────────────────────────────

  protected async request<T>(
    path: string,
    options: SupabaseRequestOptions,
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const parsed = new URL(this.url);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const port = parsed.port ? parseInt(parsed.port, 10) : (isHttps ? 443 : 80);

    const reqHeaders: Record<string, string> = {
      'apikey': this.serviceRoleKey,
      'Authorization': `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const reqPath = `${parsed.pathname === '/' ? '' : parsed.pathname}${path}`;

    return new Promise((resolve, reject) => {
      const req = client.request(
        {
          hostname: parsed.hostname,
          port,
          path: reqPath,
          method,
          headers: reqHeaders,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Supabase API error ${res.statusCode}: ${body}`));
              return;
            }

            if (options.returnHeaders) {
              try {
                const data = body ? JSON.parse(body) : null;
                resolve({ data, headers: res.headers } as unknown as T);
              } catch (e) {
                logger.debug('Failed to parse response body with headers', { error: e instanceof Error ? e.message : String(e) });
                resolve({ data: null, headers: res.headers } as unknown as T);
              }
              return;
            }

            try {
              resolve(body ? JSON.parse(body) : (null as unknown as T));
            } catch (e) {
              logger.debug('Failed to parse response body', { error: e instanceof Error ? e.message : String(e) });
              resolve(null as unknown as T);
            }
          });
        },
      );
      req.on('error', reject);

      if (options.body !== undefined) {
        req.write(JSON.stringify(options.body));
      }
      req.end();
    });
  }
}
