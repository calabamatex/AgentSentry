import type Database from 'better-sqlite3';

export interface QueryPlan {
  steps: Array<{ id: number; parent: number; detail: string }>;
  usesIndex: boolean;
  indexName?: string;
  isFullScan: boolean;
}

export interface TableStats {
  table: string;
  rowCount: number;
  indexCount: number;
  indexes: string[];
  sizeEstimate: string;
}

export class QueryOptimizer {
  private db: Database.Database;

  constructor({ db }: { db: Database.Database }) {
    this.db = db;
  }

  addCompositeIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_session_type ON ops_events(session_id, event_type);
      CREATE INDEX IF NOT EXISTS idx_events_session_timestamp ON ops_events(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type_severity ON ops_events(event_type, severity);
      CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON ops_events(event_type, timestamp DESC);
    `);
  }

  explain(sql: string, params?: any[]): QueryPlan {
    const stmt = this.db.prepare(`EXPLAIN QUERY PLAN ${sql}`);
    const rows = (params ? stmt.all(...params) : stmt.all()) as Array<{
      id: number;
      parent: number;
      notused: number;
      detail: string;
    }>;

    const steps = rows.map((row) => ({
      id: row.id,
      parent: row.parent,
      detail: row.detail,
    }));

    const isFullScan = steps.some(
      (step) =>
        step.detail.includes('SCAN') && !step.detail.includes('USING INDEX')
    );

    const indexStep = steps.find((step) =>
      step.detail.includes('USING INDEX')
    );

    const indexMatch = indexStep?.detail.match(/USING (?:COVERING )?INDEX (\S+)/);

    return {
      steps,
      usesIndex: !!indexStep,
      indexName: indexMatch?.[1],
      isFullScan,
    };
  }

  analyzeTable(table: string): TableStats {
    this.db.exec(`ANALYZE ${table}`);

    const countRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM ${table}`)
      .get() as { cnt: number };
    const rowCount = countRow.cnt;

    const indexRows = this.db
      .prepare(`PRAGMA index_list('${table}')`)
      .all() as Array<{ name: string }>;
    const indexes = indexRows.map((row) => row.name);

    const pageCountRow = this.db
      .prepare(
        `SELECT SUM("pgsize") as total FROM dbstat WHERE name = ?`
      )
      .get(table) as { total: number } | undefined;

    let sizeEstimate: string;
    const totalBytes = pageCountRow?.total;

    if (!totalBytes || totalBytes === 0) {
      // Fallback: estimate from page_count * page_size
      const pageSize = (
        this.db.prepare('PRAGMA page_size').get() as { page_size: number }
      ).page_size;
      const pageCount = (
        this.db.prepare('PRAGMA page_count').get() as { page_count: number }
      ).page_count;
      const estimated = pageSize * pageCount;
      sizeEstimate = formatBytes(estimated);
    } else {
      sizeEstimate = formatBytes(totalBytes);
    }

    return {
      table,
      rowCount,
      indexCount: indexes.length,
      indexes,
      sizeEstimate,
    };
  }

  optimizeConnection(db: Database.Database): void {
    db.pragma('cache_size = -64000');
    db.pragma('temp_store = MEMORY');
    db.pragma('mmap_size = 268435456');
    db.pragma('synchronous = NORMAL');
  }
}

export class PreparedStatementCache {
  private db: Database.Database;
  private maxStatements: number;
  private cache: Map<string, Database.Statement>;
  private hits: number;
  private misses: number;

  constructor({
    db,
    maxStatements = 50,
  }: {
    db: Database.Database;
    maxStatements?: number;
  }) {
    this.db = db;
    this.maxStatements = maxStatements;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  prepare(sql: string): Database.Statement {
    const cached = this.cache.get(sql);
    if (cached) {
      this.hits++;
      // Move to end for LRU ordering
      this.cache.delete(sql);
      this.cache.set(sql, cached);
      return cached;
    }

    this.misses++;

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxStatements) {
      const oldestKey = this.cache.keys().next().value as string;
      this.cache.delete(oldestKey);
    }

    const stmt = this.db.prepare(sql);
    this.cache.set(sql, stmt);
    return stmt;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  stats(): { size: number; maxSize: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxStatements,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
