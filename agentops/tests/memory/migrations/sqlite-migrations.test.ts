import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, getCurrentVersion, LATEST_VERSION } from '../../../src/memory/migrations/sqlite-migrations';

describe('SQLite Migrations', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it('creates schema on fresh database', () => {
    db = new Database(':memory:');
    runMigrations(db);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('ops_events');
    expect(tableNames).toContain('ops_embeddings');
    expect(tableNames).toContain('schema_version');
  });

  it('sets version to latest after migration', () => {
    db = new Database(':memory:');
    runMigrations(db);
    expect(getCurrentVersion(db)).toBe(LATEST_VERSION);
  });

  it('is idempotent (running twice does not error)', () => {
    db = new Database(':memory:');
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(getCurrentVersion(db)).toBe(LATEST_VERSION);
  });

  it('creates expected indexes', () => {
    db = new Database(':memory:');
    runMigrations(db);

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_events_type');
    expect(indexNames).toContain('idx_events_session');
    expect(indexNames).toContain('idx_events_severity');
    expect(indexNames).toContain('idx_events_skill');
    expect(indexNames).toContain('idx_events_timestamp');
  });
});
