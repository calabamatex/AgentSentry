/**
 * sqlite-provider.ts — SQLite storage backend for AgentSentry memory store.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { StorageProvider } from './storage-provider';
import { runMigrations } from '../migrations/sqlite-migrations';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'sqlite-provider' });
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

/** Shape of a row returned from the ops_events SQLite table */
interface OpsEventRow {
  id: string;
  timestamp: string;
  session_id: string;
  agent_id: string;
  event_type: string;
  severity: string;
  skill: string;
  title: string;
  detail: string;
  affected_files: string;
  tags: string;
  metadata: string;
  hash: string;
  prev_hash: string;
  embedding?: string;
  schema_version?: number;
}

export class SqliteProvider implements StorageProvider {
  readonly name = 'sqlite';
  readonly mode = 'local' as const;
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.resolve('agent-sentry/data/ops.db');
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    runMigrations(this.db);
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private getDb(): Database.Database {
    if (!this.db) throw new Error('SqliteProvider not initialized');
    return this.db;
  }

  async insert(event: OpsEvent): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO ops_events (id, timestamp, session_id, agent_id, event_type, severity, skill, title, detail, affected_files, tags, metadata, hash, prev_hash, schema_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.timestamp,
      event.session_id,
      event.agent_id,
      event.event_type,
      event.severity,
      event.skill,
      event.title,
      event.detail,
      JSON.stringify(event.affected_files),
      JSON.stringify(event.tags),
      JSON.stringify(event.metadata),
      event.hash,
      event.prev_hash,
      event.schema_version ?? 1,
    );

    if (event.embedding && event.embedding.length > 0) {
      const embStmt = db.prepare('INSERT INTO ops_embeddings (id, embedding, timestamp) VALUES (?, ?, ?)');
      const buffer = Buffer.from(new Float32Array(event.embedding).buffer);
      embStmt.run(event.id, buffer, event.timestamp);
    }
  }

  async getById(id: string): Promise<OpsEvent | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM ops_events WHERE id = ?').get(id) as OpsEventRow | undefined;
    if (!row) return null;
    return this.rowToEvent(row);
  }

  async query(options: QueryOptions): Promise<OpsEvent[]> {
    const db = this.getDb();
    const { sql, params } = this.buildQuery(options);
    const rows = db.prepare(sql).all(...params) as OpsEventRow[];
    return rows.map((r) => this.rowToEvent(r));
  }

  async count(options: QueryOptions): Promise<number> {
    const db = this.getDb();
    const { sql, params } = this.buildQuery(options, true);
    const row = db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  /**
   * Vector search using cosine similarity.
   * This is a linear scan (O(n)) bounded to the most recent MAX_VECTOR_SCAN
   * embeddings. For datasets exceeding 50,000 events, consider an external
   * vector database with ANN indexing.
   */
  async vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]> {
    const db = this.getDb();
    const limit = options.limit ?? 10;
    const threshold = options.threshold ?? 0.5;
    const MAX_VECTOR_SCAN = 10000;

    // Pre-filter with JOIN: apply metadata filters in SQL before similarity computation
    let embQuery = 'SELECT e.id, e.embedding FROM ops_embeddings e INNER JOIN ops_events ev ON e.id = ev.id';
    const embConditions: string[] = [];
    const embParams: (string | number)[] = [];

    if (options.since) { embConditions.push('e.timestamp >= ?'); embParams.push(options.since); }
    if (options.event_type) { embConditions.push('ev.event_type = ?'); embParams.push(options.event_type); }
    if (options.severity) { embConditions.push('ev.severity = ?'); embParams.push(options.severity); }
    if (options.skill) { embConditions.push('ev.skill = ?'); embParams.push(options.skill); }
    if (options.session_id) { embConditions.push('ev.session_id = ?'); embParams.push(options.session_id); }

    if (embConditions.length > 0) {
      embQuery += ' WHERE ' + embConditions.join(' AND ');
    }

    // Cap scan window: when no 'since' filter, limit to most recent embeddings
    if (!options.since) {
      embQuery = `SELECT * FROM (${embQuery} ORDER BY e.timestamp DESC LIMIT ${MAX_VECTOR_SCAN})`;
    }

    // Process in chunks of 1000 to avoid loading all into memory
    const CHUNK_SIZE = 1000;
    let offset = 0;
    const topN = limit;
    const topScores: { id: string; score: number }[] = [];
    let minScore = threshold;

    while (true) {
      const chunk = db.prepare(`${embQuery} LIMIT ? OFFSET ?`).all(...embParams, CHUNK_SIZE, offset) as { id: string; embedding: Buffer }[];
      if (chunk.length === 0) break;

      for (const row of chunk) {
        const stored = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
        const score = cosineSimilarity(embedding, stored);
        if (score < minScore) continue;

        if (topScores.length < topN) {
          topScores.push({ id: row.id, score });
          if (topScores.length === topN) {
            topScores.sort((a, b) => b.score - a.score);
            minScore = topScores[topN - 1].score;
          }
        } else if (score > minScore) {
          topScores[topN - 1] = { id: row.id, score };
          topScores.sort((a, b) => b.score - a.score);
          minScore = topScores[topN - 1].score;
        }
      }

      offset += CHUNK_SIZE;
    }

    // Final sort to ensure descending order before fetching events
    topScores.sort((a, b) => b.score - a.score);

    // Fetch full events (metadata already filtered via SQL JOIN)
    const results: SearchResult[] = [];
    for (const { id, score } of topScores) {
      if (results.length >= limit) break;
      const event = await this.getById(id);
      if (!event) continue;
      results.push({ event, score });
    }
    return results;
  }

  async aggregate(options: AggregateOptions): Promise<OpsStats> {
    const db = this.getDb();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since); }
    if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until); }
    if (options.session_id) { conditions.push('session_id = ?'); params.push(options.session_id); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Single query for total count + time range
    const summary = db.prepare(
      `SELECT COUNT(*) as total, MIN(timestamp) as first_ts, MAX(timestamp) as last_ts FROM ops_events ${where}`
    ).get(...params) as { total: number; first_ts: string | null; last_ts: string | null };

    // GROUP BY queries (3 instead of 19 individual COUNTs)
    const typeRows = db.prepare(
      `SELECT event_type, COUNT(*) as cnt FROM ops_events ${where} GROUP BY event_type`
    ).all(...params) as { event_type: string; cnt: number }[];

    const severityRows = db.prepare(
      `SELECT severity, COUNT(*) as cnt FROM ops_events ${where} GROUP BY severity`
    ).all(...params) as { severity: string; cnt: number }[];

    const skillRows = db.prepare(
      `SELECT skill, COUNT(*) as cnt FROM ops_events ${where} GROUP BY skill`
    ).all(...params) as { skill: string; cnt: number }[];

    // Build result maps (initialize all known values to 0, then fill from results)
    const byType = {} as Record<EventType, number>;
    for (const t of EVENT_TYPES) byType[t] = 0;
    for (const row of typeRows) byType[row.event_type as EventType] = row.cnt;

    const bySeverity = {} as Record<Severity, number>;
    for (const s of SEVERITIES) bySeverity[s] = 0;
    for (const row of severityRows) bySeverity[row.severity as Severity] = row.cnt;

    const bySkill = {} as Record<Skill, number>;
    for (const sk of SKILLS) bySkill[sk] = 0;
    for (const row of skillRows) bySkill[row.skill as Skill] = row.cnt;

    return {
      total_events: summary.total,
      by_type: byType,
      by_severity: bySeverity,
      by_skill: bySkill,
      first_event: summary.first_ts ?? undefined,
      last_event: summary.last_ts ?? undefined,
    };
  }

  async getChain(since?: string): Promise<OpsEvent[]> {
    const db = this.getDb();
    let sql = 'SELECT * FROM ops_events';
    const params: (string | number)[] = [];
    if (since) {
      sql += ' WHERE timestamp >= ?';
      params.push(since);
    }
    sql += ' ORDER BY timestamp ASC';
    const rows = db.prepare(sql).all(...params) as OpsEventRow[];
    return rows.map((r) => this.rowToEvent(r));
  }

  async prune(options: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }> {
    const db = this.getDb();
    let totalDeleted = 0;

    // Prune by age first
    if (options.maxAgeDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.maxAgeDays);
      const cutoffStr = cutoff.toISOString();

      // Delete embeddings first (FK constraint)
      db.prepare('DELETE FROM ops_embeddings WHERE id IN (SELECT id FROM ops_events WHERE timestamp < ?)').run(cutoffStr);
      const result = db.prepare('DELETE FROM ops_events WHERE timestamp < ?').run(cutoffStr);
      totalDeleted += result.changes;
    }

    // Then prune by count (keep newest)
    if (options.maxEvents) {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM ops_events').get() as { cnt: number };
      if (count.cnt > options.maxEvents) {
        const excess = count.cnt - options.maxEvents;
        // Delete oldest events beyond the limit
        db.prepare(`DELETE FROM ops_embeddings WHERE id IN (SELECT id FROM ops_events ORDER BY timestamp ASC LIMIT ?)`).run(excess);
        const result = db.prepare(`DELETE FROM ops_events WHERE id IN (SELECT id FROM ops_events ORDER BY timestamp ASC LIMIT ?)`).run(excess);
        totalDeleted += result.changes;
      }
    }

    return { deleted: totalDeleted };
  }

  async saveChainCheckpoint(checkpoint: { lastEventId: string; lastEventHash: string; eventsVerified: number }): Promise<void> {
    const db = this.getDb();
    db.prepare(`INSERT INTO chain_checkpoints (verified_at, last_event_id, last_event_hash, events_verified) VALUES (?, ?, ?, ?)`).run(
      new Date().toISOString(),
      checkpoint.lastEventId,
      checkpoint.lastEventHash,
      checkpoint.eventsVerified,
    );
  }

  async getLastChainCheckpoint(): Promise<{ lastEventId: string; lastEventHash: string; eventsVerified: number; verifiedAt: string } | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM chain_checkpoints ORDER BY id DESC LIMIT 1').get() as { last_event_id: string; last_event_hash: string; events_verified: number; verified_at: string } | undefined;
    if (!row) return null;
    return {
      lastEventId: row.last_event_id,
      lastEventHash: row.last_event_hash,
      eventsVerified: row.events_verified,
      verifiedAt: row.verified_at,
    };
  }

  async textSearch(query: string, options: QueryOptions): Promise<OpsEvent[]> {
    const db = this.getDb();
    const conditions: string[] = ['(title LIKE ? OR detail LIKE ?)'];
    const likePattern = `%${query}%`;
    const params: (string | number)[] = [likePattern, likePattern];

    if (options.event_type) { conditions.push('event_type = ?'); params.push(options.event_type); }
    if (options.severity) { conditions.push('severity = ?'); params.push(options.severity); }
    if (options.skill) { conditions.push('skill = ?'); params.push(options.skill); }
    if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since); }
    if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until); }
    if (options.session_id) { conditions.push('session_id = ?'); params.push(options.session_id); }
    if (options.agent_id) { conditions.push('agent_id = ?'); params.push(options.agent_id); }
    if (options.tag) { conditions.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)"); params.push(options.tag); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;

    const sql = `SELECT * FROM ops_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, limit, offset) as OpsEventRow[];
    return rows.map((r) => this.rowToEvent(r));
  }

  async getLatestHash(): Promise<string | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT hash FROM ops_events ORDER BY timestamp DESC, rowid DESC LIMIT 1').get() as { hash: string } | undefined;
    return row?.hash ?? null;
  }

  async atomicLockAcquire(resource: string, holder: string, fencingToken: number, expiresAt: string): Promise<boolean> {
    const db = this.getDb();
    const now = new Date().toISOString();

    // Clean expired locks first
    db.prepare('DELETE FROM coordination_locks WHERE expires_at < ?').run(now);

    // Attempt atomic insert — fails silently if resource already locked
    const result = db.prepare(
      'INSERT OR IGNORE INTO coordination_locks (resource, holder, fencing_token, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(resource, holder, fencingToken, now, expiresAt);

    if (result.changes > 0) {
      return true; // Lock acquired
    }

    // Check if we already hold this lock (re-entrant)
    const existing = db.prepare('SELECT holder FROM coordination_locks WHERE resource = ?').get(resource) as { holder: string } | undefined;
    return existing?.holder === holder;
  }

  async atomicLockRelease(resource: string, holder: string): Promise<boolean> {
    const db = this.getDb();
    const result = db.prepare('DELETE FROM coordination_locks WHERE resource = ? AND holder = ?').run(resource, holder);
    return result.changes > 0;
  }

  async atomicLockGet(resource: string): Promise<{ resource: string; holder: string; fencingToken: number; acquiredAt: string; expiresAt: string } | null> {
    const db = this.getDb();
    const now = new Date().toISOString();

    // Clean expired first
    db.prepare('DELETE FROM coordination_locks WHERE expires_at < ?').run(now);

    const row = db.prepare('SELECT * FROM coordination_locks WHERE resource = ?').get(resource) as {
      resource: string; holder: string; fencing_token: number; acquired_at: string; expires_at: string;
    } | undefined;

    if (!row) return null;
    return {
      resource: row.resource,
      holder: row.holder,
      fencingToken: row.fencing_token,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
    };
  }

  private buildQuery(options: QueryOptions, countOnly = false): { sql: string; params: (string | number)[] } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.event_type) { conditions.push('event_type = ?'); params.push(options.event_type); }
    if (options.severity) { conditions.push('severity = ?'); params.push(options.severity); }
    if (options.skill) { conditions.push('skill = ?'); params.push(options.skill); }
    if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since); }
    if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until); }
    if (options.session_id) { conditions.push('session_id = ?'); params.push(options.session_id); }
    if (options.agent_id) { conditions.push('agent_id = ?'); params.push(options.agent_id); }
    if (options.tag) { conditions.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)"); params.push(options.tag); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    if (countOnly) {
      return { sql: `SELECT COUNT(*) as cnt FROM ops_events ${where}`, params };
    }

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    return {
      sql: `SELECT * FROM ops_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      params: [...params, limit, offset],
    };
  }

  private rowToEvent(row: OpsEventRow): OpsEvent {
    const event: OpsEvent = {
      id: row.id,
      timestamp: row.timestamp,
      session_id: row.session_id,
      agent_id: row.agent_id,
      event_type: row.event_type as EventType,
      severity: row.severity as Severity,
      skill: row.skill as Skill,
      title: row.title,
      detail: row.detail,
      affected_files: safeJsonParse<string[]>(row.affected_files, []),
      tags: safeJsonParse<string[]>(row.tags, []),
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
      hash: row.hash,
      prev_hash: row.prev_hash,
      schema_version: row.schema_version ?? 1,
    };
    return event;
  }
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    logger.debug('JSON parse failed in safeJsonParse', { error: e instanceof Error ? e.message : String(e) });
    return fallback;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
