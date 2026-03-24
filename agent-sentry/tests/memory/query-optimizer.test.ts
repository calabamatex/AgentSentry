import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { QueryOptimizer, PreparedStatementCache } from '../../src/memory/query-optimizer';
import { runMigrations } from '../../src/memory/migrations/sqlite-migrations';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-query-opt.db');

describe('QueryOptimizer', () => {
  let db: Database.Database;
  let optimizer: QueryOptimizer;

  beforeEach(() => {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
    db = new Database(TEST_DB);
    runMigrations(db);
    optimizer = new QueryOptimizer({ db });
  });

  afterEach(() => {
    db?.close();
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  describe('addCompositeIndexes()', () => {
    it('creates idx_events_session_type', () => {
      optimizer.addCompositeIndexes();

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_events_session_type');
    });

    it('creates idx_events_session_timestamp', () => {
      optimizer.addCompositeIndexes();

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_events_session_timestamp');
    });

    it('creates idx_events_type_severity', () => {
      optimizer.addCompositeIndexes();

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_events_type_severity');
    });

    it('creates idx_events_type_timestamp', () => {
      optimizer.addCompositeIndexes();

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_events_type_timestamp');
    });

    it('is idempotent — calling twice does not error', () => {
      optimizer.addCompositeIndexes();
      expect(() => optimizer.addCompositeIndexes()).not.toThrow();

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_events_%'")
        .all() as { name: string }[];
      // Should still have the same indexes, no duplicates
      const compositeNames = indexes.map((i) => i.name).filter((n) =>
        ['idx_events_session_type', 'idx_events_session_timestamp',
         'idx_events_type_severity', 'idx_events_type_timestamp'].includes(n)
      );
      expect(compositeNames).toHaveLength(4);
    });
  });

  describe('explain()', () => {
    it('returns steps array from EXPLAIN QUERY PLAN', () => {
      const plan = optimizer.explain('SELECT * FROM ops_events');

      expect(plan.steps).toBeDefined();
      expect(Array.isArray(plan.steps)).toBe(true);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0]).toHaveProperty('id');
      expect(plan.steps[0]).toHaveProperty('parent');
      expect(plan.steps[0]).toHaveProperty('detail');
    });

    it('detects index usage (usesIndex true when index used)', () => {
      // Query on session_id which has an index from migration v1
      const plan = optimizer.explain(
        'SELECT * FROM ops_events WHERE session_id = ?',
        ['test-session']
      );

      expect(plan.usesIndex).toBe(true);
    });

    it('returns indexName when using an index', () => {
      const plan = optimizer.explain(
        'SELECT * FROM ops_events WHERE session_id = ?',
        ['test-session']
      );

      expect(plan.indexName).toBeDefined();
      expect(typeof plan.indexName).toBe('string');
      expect(plan.indexName).toContain('idx_events_session');
    });

    it('detects full scan (isFullScan true when scanning without index)', () => {
      // Query on detail column which has no index
      const plan = optimizer.explain(
        "SELECT * FROM ops_events WHERE detail LIKE '%something%'"
      );

      expect(plan.isFullScan).toBe(true);
    });

    it('after addCompositeIndexes, query on (session_id, event_type) uses composite index', () => {
      optimizer.addCompositeIndexes();

      const plan = optimizer.explain(
        'SELECT * FROM ops_events WHERE session_id = ? AND event_type = ?',
        ['test-session', 'test-type']
      );

      expect(plan.usesIndex).toBe(true);
      expect(plan.indexName).toBe('idx_events_session_type');
    });
  });

  describe('analyzeTable()', () => {
    it('returns correct rowCount', () => {
      // Insert some rows
      const insert = db.prepare(
        `INSERT INTO ops_events (id, timestamp, session_id, agent_id, event_type, severity, skill, title, detail, affected_files, tags, metadata, hash, prev_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      insert.run('e1', '2025-01-01T00:00:00Z', 's1', 'a1', 'code_change', 'info', 'coder', 'Test', 'detail', '[]', '[]', '{}', 'h1', 'h0');
      insert.run('e2', '2025-01-01T00:01:00Z', 's1', 'a1', 'review', 'warning', 'reviewer', 'Test2', 'detail2', '[]', '[]', '{}', 'h2', 'h1');

      const stats = optimizer.analyzeTable('ops_events');
      expect(stats.rowCount).toBe(2);
    });

    it('returns index list', () => {
      const stats = optimizer.analyzeTable('ops_events');

      expect(stats.indexes).toBeDefined();
      expect(Array.isArray(stats.indexes)).toBe(true);
      // Migration v1 creates several indexes on ops_events
      expect(stats.indexes.length).toBeGreaterThan(0);
      expect(stats.indexes).toContain('idx_events_type');
      expect(stats.indexes).toContain('idx_events_session');
    });

    it('returns sizeEstimate as string with units', () => {
      const stats = optimizer.analyzeTable('ops_events');

      expect(typeof stats.sizeEstimate).toBe('string');
      // Should match pattern like "4.0 KB" or "0 B" or "1.5 MB"
      expect(stats.sizeEstimate).toMatch(/^\d+(\.\d+)?\s+(B|KB|MB|GB)$/);
    });
  });

  describe('optimizeConnection()', () => {
    it('sets cache_size pragma', () => {
      optimizer.optimizeConnection(db);

      const result = db.prepare('PRAGMA cache_size').get() as { cache_size: number };
      expect(result.cache_size).toBe(-64000);
    });

    it('sets synchronous to NORMAL', () => {
      optimizer.optimizeConnection(db);

      const result = db.prepare('PRAGMA synchronous').get() as { synchronous: number };
      // NORMAL = 1
      expect(result.synchronous).toBe(1);
    });
  });
});

describe('PreparedStatementCache', () => {
  let db: Database.Database;
  let cache: PreparedStatementCache;

  beforeEach(() => {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
    db = new Database(TEST_DB);
    runMigrations(db);
    cache = new PreparedStatementCache({ db });
  });

  afterEach(() => {
    db?.close();
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  it('prepare() returns a Statement', () => {
    const stmt = cache.prepare('SELECT * FROM ops_events');

    expect(stmt).toBeDefined();
    expect(typeof stmt.all).toBe('function');
    expect(typeof stmt.run).toBe('function');
    expect(typeof stmt.get).toBe('function');
  });

  it('prepare() caches on second call (stats shows hits)', () => {
    cache.prepare('SELECT * FROM ops_events');
    cache.prepare('SELECT * FROM ops_events');

    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  it('stats() tracks hits and misses correctly', () => {
    cache.prepare('SELECT 1');
    cache.prepare('SELECT 2');
    cache.prepare('SELECT 1'); // hit
    cache.prepare('SELECT 2'); // hit
    cache.prepare('SELECT 3');
    cache.prepare('SELECT 3'); // hit

    const s = cache.stats();
    expect(s.misses).toBe(3);
    expect(s.hits).toBe(3);
    expect(s.size).toBe(3);
  });

  it('size getter returns cached count', () => {
    expect(cache.size).toBe(0);

    cache.prepare('SELECT 1');
    expect(cache.size).toBe(1);

    cache.prepare('SELECT 2');
    expect(cache.size).toBe(2);

    // Re-accessing should not increase size
    cache.prepare('SELECT 1');
    expect(cache.size).toBe(2);
  });

  it('clear() empties the cache', () => {
    cache.prepare('SELECT 1');
    cache.prepare('SELECT 2');
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('evicts oldest when maxStatements exceeded', () => {
    const smallCache = new PreparedStatementCache({ db, maxStatements: 3 });

    smallCache.prepare('SELECT 1'); // oldest
    smallCache.prepare('SELECT 2');
    smallCache.prepare('SELECT 3');
    expect(smallCache.size).toBe(3);

    // Adding a 4th should evict 'SELECT 1'
    smallCache.prepare('SELECT 4');
    expect(smallCache.size).toBe(3);

    // 'SELECT 1' should now be a miss (evicted), not a hit
    const statsBefore = smallCache.stats();
    const missesBefore = statsBefore.misses;

    smallCache.prepare('SELECT 1');
    const statsAfter = smallCache.stats();
    expect(statsAfter.misses).toBe(missesBefore + 1);
  });
});

describe('Migration v3 — composite indexes', () => {
  let db: Database.Database;

  beforeEach(() => {
    fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
    db = new Database(TEST_DB);
  });

  afterEach(() => {
    db?.close();
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  it('migration v3 applies and creates composite indexes', () => {
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);

    expect(names).toContain('idx_events_session_type');
    expect(names).toContain('idx_events_session_timestamp');
    expect(names).toContain('idx_events_type_severity');
    expect(names).toContain('idx_events_type_timestamp');
  });
});
