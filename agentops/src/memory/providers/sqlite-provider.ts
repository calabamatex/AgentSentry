/**
 * sqlite-provider.ts — SQLite storage backend for AgentOps memory store.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { StorageProvider } from './storage-provider';
import { runMigrations } from '../migrations/sqlite-migrations';
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

export class SqliteProvider implements StorageProvider {
  readonly name = 'sqlite';
  readonly mode = 'local' as const;
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.resolve('agentops/data/ops.db');
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
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
      INSERT INTO ops_events (id, timestamp, session_id, agent_id, event_type, severity, skill, title, detail, affected_files, tags, metadata, hash, prev_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );

    if (event.embedding && event.embedding.length > 0) {
      const embStmt = db.prepare('INSERT INTO ops_embeddings (id, embedding, timestamp) VALUES (?, ?, ?)');
      const buffer = Buffer.from(new Float32Array(event.embedding).buffer);
      embStmt.run(event.id, buffer, event.timestamp);
    }
  }

  async getById(id: string): Promise<OpsEvent | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM ops_events WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToEvent(row);
  }

  async query(options: QueryOptions): Promise<OpsEvent[]> {
    const db = this.getDb();
    const { sql, params } = this.buildQuery(options);
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.rowToEvent(r));
  }

  async count(options: QueryOptions): Promise<number> {
    const db = this.getDb();
    const { sql, params } = this.buildQuery(options, true);
    const row = db.prepare(sql).get(...params) as { cnt: number };
    return row.cnt;
  }

  async vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]> {
    const db = this.getDb();
    const limit = options.limit ?? 10;
    const threshold = options.threshold ?? 0.5;

    // Pre-filter embeddings by timestamp if 'since' is provided
    let embQuery = 'SELECT e.id, e.embedding FROM ops_embeddings e';
    const embParams: any[] = [];

    if (options.since) {
      embQuery += ' WHERE e.timestamp >= ?';
      embParams.push(options.since);
    }

    // Process in chunks of 1000 to avoid loading all into memory
    const CHUNK_SIZE = 1000;
    let offset = 0;
    const topScores: { id: string; score: number }[] = [];

    while (true) {
      const chunk = db.prepare(`${embQuery} LIMIT ? OFFSET ?`).all(...embParams, CHUNK_SIZE, offset) as { id: string; embedding: Buffer }[];
      if (chunk.length === 0) break;

      for (const row of chunk) {
        const stored = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
        const score = cosineSimilarity(embedding, stored);
        if (score >= threshold) {
          // Maintain a sorted top-N list
          if (topScores.length < limit * 2) {
            topScores.push({ id: row.id, score });
            topScores.sort((a, b) => b.score - a.score);
          } else if (score > topScores[topScores.length - 1].score) {
            topScores[topScores.length - 1] = { id: row.id, score };
            topScores.sort((a, b) => b.score - a.score);
          }
        }
      }

      offset += CHUNK_SIZE;
    }

    // Fetch full events and apply remaining filters
    const results: SearchResult[] = [];
    for (const { id, score } of topScores) {
      if (results.length >= limit) break;
      const event = await this.getById(id);
      if (!event) continue;
      if (options.event_type && event.event_type !== options.event_type) continue;
      if (options.severity && event.severity !== options.severity) continue;
      if (options.skill && event.skill !== options.skill) continue;
      if (options.session_id && event.session_id !== options.session_id) continue;
      results.push({ event, score });
    }
    return results;
  }

  async aggregate(options: AggregateOptions): Promise<OpsStats> {
    const db = this.getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since); }
    if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until); }
    if (options.session_id) { conditions.push('session_id = ?'); params.push(options.session_id); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM ops_events ${where}`).get(...params) as { cnt: number };

    const byType: Record<EventType, number> = {} as any;
    for (const t of EVENT_TYPES) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ops_events ${where ? where + ' AND' : 'WHERE'} event_type = ?`).get(...params, t) as { cnt: number };
      byType[t] = row.cnt;
    }

    const bySeverity: Record<Severity, number> = {} as any;
    for (const s of SEVERITIES) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ops_events ${where ? where + ' AND' : 'WHERE'} severity = ?`).get(...params, s) as { cnt: number };
      bySeverity[s] = row.cnt;
    }

    const bySkill: Record<Skill, number> = {} as any;
    for (const sk of SKILLS) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ops_events ${where ? where + ' AND' : 'WHERE'} skill = ?`).get(...params, sk) as { cnt: number };
      bySkill[sk] = row.cnt;
    }

    const firstRow = db.prepare(`SELECT MIN(timestamp) as ts FROM ops_events ${where}`).get(...params) as { ts: string | null };
    const lastRow = db.prepare(`SELECT MAX(timestamp) as ts FROM ops_events ${where}`).get(...params) as { ts: string | null };

    return {
      total_events: total.cnt,
      by_type: byType,
      by_severity: bySeverity,
      by_skill: bySkill,
      first_event: firstRow.ts ?? undefined,
      last_event: lastRow.ts ?? undefined,
    };
  }

  async getChain(since?: string): Promise<OpsEvent[]> {
    const db = this.getDb();
    let sql = 'SELECT * FROM ops_events';
    const params: any[] = [];
    if (since) {
      sql += ' WHERE timestamp >= ?';
      params.push(since);
    }
    sql += ' ORDER BY timestamp ASC';
    const rows = db.prepare(sql).all(...params) as any[];
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
    const row = db.prepare('SELECT * FROM chain_checkpoints ORDER BY id DESC LIMIT 1').get() as any;
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
    const params: any[] = [likePattern, likePattern];

    if (options.event_type) { conditions.push('event_type = ?'); params.push(options.event_type); }
    if (options.severity) { conditions.push('severity = ?'); params.push(options.severity); }
    if (options.skill) { conditions.push('skill = ?'); params.push(options.skill); }
    if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since); }
    if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until); }
    if (options.session_id) { conditions.push('session_id = ?'); params.push(options.session_id); }
    if (options.agent_id) { conditions.push('agent_id = ?'); params.push(options.agent_id); }
    if (options.tag) { conditions.push("tags LIKE ?"); params.push(`%"${options.tag}"%`); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;

    const sql = `SELECT * FROM ops_events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    const rows = db.prepare(sql).all(...params, limit, offset) as any[];
    return rows.map((r: any) => this.rowToEvent(r));
  }

  private buildQuery(options: QueryOptions, countOnly = false): { sql: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.event_type) { conditions.push('event_type = ?'); params.push(options.event_type); }
    if (options.severity) { conditions.push('severity = ?'); params.push(options.severity); }
    if (options.skill) { conditions.push('skill = ?'); params.push(options.skill); }
    if (options.since) { conditions.push('timestamp >= ?'); params.push(options.since); }
    if (options.until) { conditions.push('timestamp <= ?'); params.push(options.until); }
    if (options.session_id) { conditions.push('session_id = ?'); params.push(options.session_id); }
    if (options.agent_id) { conditions.push('agent_id = ?'); params.push(options.agent_id); }
    if (options.tag) { conditions.push("tags LIKE ?"); params.push(`%"${options.tag}"%`); }

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

  private rowToEvent(row: any): OpsEvent {
    const event: OpsEvent = {
      id: row.id,
      timestamp: row.timestamp,
      session_id: row.session_id,
      agent_id: row.agent_id,
      event_type: row.event_type,
      severity: row.severity,
      skill: row.skill,
      title: row.title,
      detail: row.detail,
      affected_files: safeJsonParse<string[]>(row.affected_files, []),
      tags: safeJsonParse<string[]>(row.tags, []),
      metadata: safeJsonParse<Record<string, unknown>>(row.metadata, {}),
      hash: row.hash,
      prev_hash: row.prev_hash,
    };
    return event;
  }
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
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
