/**
 * supabase-base.ts — Abstract base class for Supabase (PostgREST) storage providers.
 *
 * Consolidates shared query-building, row-mapping, and CRUD logic used by both
 * SupabaseProvider (direct HTTP) and PooledSupabaseProvider (connection-pooled HTTP).
 * Subclasses only need to implement the HTTP transport layer via `request()`.
 */

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

/**
 * Safely parse a JSON string, returning `fallback` on failure or if the value is null/undefined.
 */
export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Options passed to the abstract `request` method. */
export interface SupabaseRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  returnHeaders?: boolean;
}

/**
 * Abstract base for Supabase-backed StorageProviders.
 *
 * Subclasses must implement:
 * - `request<T>(path, options)` — the HTTP transport
 * - `initialize()` — provider-specific startup
 * - `insert(event)` — event insertion (body building is identical but kept in subclass
 *   so the `request` call is straightforward)
 * - `getById(id)` — single-event lookup
 * - `close()` — teardown
 */
export abstract class SupabaseBaseProvider implements StorageProvider {
  abstract readonly name: string;
  abstract readonly mode: 'local' | 'remote';

  protected url: string;
  protected serviceRoleKey: string;

  constructor(url: string, serviceRoleKey: string) {
    this.url = url;
    this.serviceRoleKey = serviceRoleKey;
  }

  // ── Abstract transport ──────────────────────────────────────────────────

  protected abstract request<T>(path: string, options: SupabaseRequestOptions): Promise<T>;

  // ── Lifecycle (abstract) ────────────────────────────────────────────────

  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;

  // ── CRUD (abstract — transport-dependent) ───────────────────────────────

  abstract insert(event: OpsEvent): Promise<void>;
  abstract getById(id: string): Promise<OpsEvent | null>;

  // ── Shared RPC helper ───────────────────────────────────────────────────

  protected async rpc<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(`/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      body,
    });
  }

  // ── Shared implementations ──────────────────────────────────────────────

  async query(options: QueryOptions): Promise<OpsEvent[]> {
    const params = this.buildQueryParams(options);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    params.push('order=timestamp.desc');
    params.push(`limit=${limit}`);
    params.push(`offset=${offset}`);

    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    const rows = await this.request<any[]>(`/rest/v1/ops_events${qs}`, { method: 'GET' });
    return (rows || []).map((r: any) => this.rowToEvent(r));
  }

  async count(options: QueryOptions): Promise<number> {
    const params = this.buildQueryParams(options);
    params.push('select=id');
    params.push('limit=0');

    const qs = params.length > 0 ? `?${params.join('&')}` : '';
    const result = await this.request<any>(`/rest/v1/ops_events${qs}`, {
      method: 'GET',
      headers: { 'Prefer': 'count=exact' },
      returnHeaders: true,
    });
    const contentRange = result.headers?.['content-range'];
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  }

  async vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]> {
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

  async aggregate(options: AggregateOptions): Promise<OpsStats> {
    const baseParams = this.buildAggregateParams(options);

    // Total count
    const total = await this.countWithParams(baseParams);

    // Count by type
    const byType: Record<EventType, number> = {} as any;
    for (const t of EVENT_TYPES) {
      byType[t] = await this.countWithParams([...baseParams, `event_type=eq.${t}`]);
    }

    // Count by severity
    const bySeverity: Record<Severity, number> = {} as any;
    for (const s of SEVERITIES) {
      bySeverity[s] = await this.countWithParams([...baseParams, `severity=eq.${s}`]);
    }

    // Count by skill
    const bySkill: Record<Skill, number> = {} as any;
    for (const sk of SKILLS) {
      bySkill[sk] = await this.countWithParams([...baseParams, `skill=eq.${sk}`]);
    }

    // First and last event timestamps
    const firstParams = [...baseParams, 'select=timestamp', 'order=timestamp.asc', 'limit=1'];
    const lastParams = [...baseParams, 'select=timestamp', 'order=timestamp.desc', 'limit=1'];

    const firstRows = await this.request<any[]>(`/rest/v1/ops_events?${firstParams.join('&')}`, { method: 'GET' });
    const lastRows = await this.request<any[]>(`/rest/v1/ops_events?${lastParams.join('&')}`, { method: 'GET' });

    return {
      total_events: total,
      by_type: byType,
      by_severity: bySeverity,
      by_skill: bySkill,
      first_event: firstRows?.[0]?.timestamp ?? undefined,
      last_event: lastRows?.[0]?.timestamp ?? undefined,
    };
  }

  async getChain(since?: string): Promise<OpsEvent[]> {
    const params: string[] = ['order=timestamp.asc'];
    if (since) {
      params.push(`timestamp=gte.${encodeURIComponent(since)}`);
    }
    const qs = params.join('&');
    const rows = await this.request<any[]>(`/rest/v1/ops_events?${qs}`, { method: 'GET' });
    return (rows || []).map((r: any) => this.rowToEvent(r));
  }

  async prune(options: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }> {
    let totalDeleted = 0;

    // Prune by age
    if (options.maxAgeDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.maxAgeDays);
      const cutoffStr = cutoff.toISOString();

      const deleteResult = await this.request<any>(
        `/rest/v1/ops_events?timestamp=lt.${encodeURIComponent(cutoffStr)}`,
        {
          method: 'DELETE',
          headers: { 'Prefer': 'return=representation' },
        },
      );
      totalDeleted += Array.isArray(deleteResult) ? deleteResult.length : 0;
    }

    // Prune by count (keep newest)
    if (options.maxEvents) {
      const currentCount = await this.countWithParams([]);
      if (currentCount > options.maxEvents) {
        const excess = currentCount - options.maxEvents;
        // Get the oldest excess event IDs
        const oldestRows = await this.request<any[]>(
          `/rest/v1/ops_events?select=id&order=timestamp.asc&limit=${excess}`,
          { method: 'GET' },
        );
        if (oldestRows && oldestRows.length > 0) {
          const ids = oldestRows.map((r: any) => r.id);
          const validIds = this.filterValidIds(ids);
          if (validIds.length === 0) {
            return { deleted: totalDeleted };
          }
          const idList = validIds.map((id: string) => `"${id}"`).join(',');
          const deleteResult = await this.request<any>(
            `/rest/v1/ops_events?id=in.(${idList})`,
            {
              method: 'DELETE',
              headers: { 'Prefer': 'return=representation' },
            },
          );
          totalDeleted += Array.isArray(deleteResult) ? deleteResult.length : 0;
        }
      }
    }

    return { deleted: totalDeleted };
  }

  /**
   * Filter IDs before bulk deletion. Override to add validation (e.g. UUID regex).
   * Default implementation passes all IDs through.
   */
  protected filterValidIds(ids: string[]): string[] {
    return ids;
  }

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
      headers: { 'Prefer': 'return=minimal' },
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

  // ── Protected helpers ───────────────────────────────────────────────────

  protected buildQueryParams(options: QueryOptions): string[] {
    const params: string[] = [];
    if (options.event_type) params.push(`event_type=eq.${options.event_type}`);
    if (options.severity) params.push(`severity=eq.${options.severity}`);
    if (options.skill) params.push(`skill=eq.${options.skill}`);
    if (options.since) params.push(`timestamp=gte.${encodeURIComponent(options.since)}`);
    if (options.until) params.push(`timestamp=lte.${encodeURIComponent(options.until)}`);
    if (options.session_id) params.push(`session_id=eq.${encodeURIComponent(options.session_id)}`);
    if (options.agent_id) params.push(`agent_id=eq.${encodeURIComponent(options.agent_id)}`);
    if (options.tag) params.push(`tags=cs.["${options.tag}"]`);
    return params;
  }

  protected buildAggregateParams(options: AggregateOptions): string[] {
    const params: string[] = [];
    if (options.since) params.push(`timestamp=gte.${encodeURIComponent(options.since)}`);
    if (options.until) params.push(`timestamp=lte.${encodeURIComponent(options.until)}`);
    if (options.session_id) params.push(`session_id=eq.${encodeURIComponent(options.session_id)}`);
    return params;
  }

  protected async countWithParams(params: string[]): Promise<number> {
    const allParams = [...params, 'select=id', 'limit=0'];
    const qs = allParams.join('&');
    const result = await this.request<any>(`/rest/v1/ops_events?${qs}`, {
      method: 'GET',
      headers: { 'Prefer': 'count=exact' },
      returnHeaders: true,
    });
    const contentRange = result.headers?.['content-range'];
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) return parseInt(match[1], 10);
    }
    return 0;
  }

  protected rowToEvent(row: any): OpsEvent {
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
        typeof row.tags === 'string'
          ? safeJsonParse<string[]>(row.tags, [])
          : row.tags,
      metadata:
        typeof row.metadata === 'string'
          ? safeJsonParse<Record<string, unknown>>(row.metadata, {})
          : row.metadata,
      hash: row.hash,
      prev_hash: row.prev_hash,
    };
  }

  /**
   * Build the event insertion body from an OpsEvent.
   * Shared by both provider implementations.
   */
  protected buildInsertBody(event: OpsEvent): Record<string, unknown> {
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

    return body;
  }
}
