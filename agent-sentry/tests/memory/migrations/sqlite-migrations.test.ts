import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getCurrentVersion, LATEST_VERSION } from '../../../src/memory/migrations/sqlite-migrations';

describe('sqlite-migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('runMigrations', () => {
    it('creates schema_version table', () => {
      runMigrations(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('creates ops_events table with all columns', () => {
      runMigrations(db);

      const info = db.prepare("PRAGMA table_info('ops_events')").all() as { name: string }[];
      const columns = info.map((col) => col.name);

      expect(columns).toContain('id');
      expect(columns).toContain('timestamp');
      expect(columns).toContain('session_id');
      expect(columns).toContain('agent_id');
      expect(columns).toContain('event_type');
      expect(columns).toContain('severity');
      expect(columns).toContain('skill');
      expect(columns).toContain('title');
      expect(columns).toContain('detail');
      expect(columns).toContain('affected_files');
      expect(columns).toContain('tags');
      expect(columns).toContain('metadata');
      expect(columns).toContain('hash');
      expect(columns).toContain('prev_hash');
    });

    it('creates ops_embeddings table', () => {
      runMigrations(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ops_embeddings'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('creates expected indexes', () => {
      runMigrations(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_events_type');
      expect(indexNames).toContain('idx_events_session');
      expect(indexNames).toContain('idx_events_severity');
      expect(indexNames).toContain('idx_events_skill');
      expect(indexNames).toContain('idx_events_timestamp');
    });

    it('sets schema version to latest', () => {
      runMigrations(db);

      const version = getCurrentVersion(db);
      expect(version).toBe(LATEST_VERSION);
    });

    it('is idempotent - running twice does not fail', () => {
      runMigrations(db);
      expect(() => runMigrations(db)).not.toThrow();

      const version = getCurrentVersion(db);
      expect(version).toBe(LATEST_VERSION);
    });

    it('applies V2 migration - adds timestamp to embeddings', () => {
      runMigrations(db);

      const info = db.prepare("PRAGMA table_info('ops_embeddings')").all() as { name: string }[];
      const columns = info.map((col) => col.name);
      expect(columns).toContain('timestamp');
    });

    it('applies V2 migration - creates chain_checkpoints table', () => {
      runMigrations(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chain_checkpoints'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('applies V3 migration - creates composite indexes', () => {
      runMigrations(db);

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_events_session_type');
      expect(indexNames).toContain('idx_events_session_timestamp');
      expect(indexNames).toContain('idx_events_type_severity');
      expect(indexNames).toContain('idx_events_type_timestamp');
    });

    it('applies V4 migration - creates coordination_locks table', () => {
      runMigrations(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coordination_locks'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('applies incremental migrations from a partial state', () => {
      // Simulate only V1 applied
      db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
      db.exec(`
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
      `);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);

      // Now run migrations - should apply V2, V3, V4
      runMigrations(db);

      const version = getCurrentVersion(db);
      expect(version).toBe(LATEST_VERSION);

      // Check V2 was applied
      const info = db.prepare("PRAGMA table_info('ops_embeddings')").all() as { name: string }[];
      expect(info.map((c) => c.name)).toContain('timestamp');
    });

    it('records each migration version in schema_version table', () => {
      runMigrations(db);

      const versions = db
        .prepare('SELECT version FROM schema_version ORDER BY version')
        .all() as { version: number }[];
      const versionNumbers = versions.map((v) => v.version);

      expect(versionNumbers).toContain(1);
      expect(versionNumbers).toContain(2);
      expect(versionNumbers).toContain(3);
      expect(versionNumbers).toContain(4);
    });
  });

  describe('getCurrentVersion', () => {
    it('returns 0 when schema_version table does not exist', () => {
      const version = getCurrentVersion(db);
      expect(version).toBe(0);
    });

    it('returns 0 when schema_version table is empty', () => {
      db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
      const version = getCurrentVersion(db);
      expect(version).toBe(0);
    });

    it('returns the maximum version from schema_version', () => {
      db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(2);

      const version = getCurrentVersion(db);
      expect(version).toBe(2);
    });

    it('returns correct version after full migration', () => {
      runMigrations(db);
      expect(getCurrentVersion(db)).toBe(LATEST_VERSION);
    });
  });

  describe('LATEST_VERSION', () => {
    it('is a positive integer', () => {
      expect(LATEST_VERSION).toBeGreaterThan(0);
      expect(Number.isInteger(LATEST_VERSION)).toBe(true);
    });

    it('equals 4 (current migration count)', () => {
      expect(LATEST_VERSION).toBe(4);
    });
  });
});
