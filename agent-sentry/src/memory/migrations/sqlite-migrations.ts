/**
 * sqlite-migrations.ts — Schema creation and versioning for SQLite backend.
 */

import type Database from 'better-sqlite3';
import { MIGRATION_V3_SQL } from './migration-v3';
import { MIGRATION_V4_SQL } from './migration-v4';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'sqlite-migrations' });

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS ops_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        skill TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        affected_files TEXT NOT NULL,
        tags TEXT NOT NULL,
        metadata TEXT NOT NULL,
        hash TEXT NOT NULL,
        prev_hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ops_embeddings (
        id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        FOREIGN KEY (id) REFERENCES ops_events(id)
      );

      CREATE INDEX IF NOT EXISTS idx_events_type ON ops_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_session ON ops_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_severity ON ops_events(severity);
      CREATE INDEX IF NOT EXISTS idx_events_skill ON ops_events(skill);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON ops_events(timestamp);

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `,
  },
  {
    version: 2,
    sql: `
      -- Add timestamp to embeddings for pre-filtering
      ALTER TABLE ops_embeddings ADD COLUMN timestamp TEXT;

      -- Backfill from ops_events
      UPDATE ops_embeddings SET timestamp = (SELECT timestamp FROM ops_events WHERE ops_events.id = ops_embeddings.id);

      -- Index for time-filtered vector search
      CREATE INDEX IF NOT EXISTS idx_embeddings_timestamp ON ops_embeddings(timestamp);

      -- Chain verification checkpoint table
      CREATE TABLE IF NOT EXISTS chain_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        verified_at TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        last_event_hash TEXT NOT NULL,
        events_verified INTEGER NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: MIGRATION_V3_SQL,
  },
  {
    version: 4,
    sql: MIGRATION_V4_SQL,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  const current = currentVersion?.v ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      db.exec(migration.sql);
      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(migration.version);
    }
  }
}

export function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
    return row?.v ?? 0;
  } catch (e) {
    logger.debug('Failed to get current schema version', { error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
