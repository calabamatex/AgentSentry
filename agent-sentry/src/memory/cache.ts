/**
 * cache.ts — LRU cache layer sitting between MemoryStore and StorageProvider.
 * Zero external dependencies; pure TypeScript with Node built-ins only.
 */

import type { StorageProvider } from './providers/storage-provider';
import type {
  OpsEvent,
  QueryOptions,
  VectorSearchOptions,
  SearchResult,
  AggregateOptions,
  OpsStats,
} from './schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LRUCacheOptions {
  maxSize?: number;
  defaultTtl?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
  evictions: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// LRUCache
// ---------------------------------------------------------------------------

export class LRUCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTtl: number;

  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(options: LRUCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.defaultTtl ?? 300_000; // 5 minutes
  }

  get size(): number {
    return this.store.size;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this._misses++;
      return undefined;
    }

    // Move to end (most recently used) by re-inserting
    this.store.delete(key);
    this.store.set(key, entry);
    this._hits++;
    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    // If key already exists, remove it first so insertion goes to the end
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value as string;
      this.store.delete(oldest);
      this._evictions++;
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.defaultTtl),
    });
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) {
      return false;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
      size: this.store.size,
      maxSize: this.maxSize,
      evictions: this._evictions,
    };
  }

  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /** Reduce the TTL of all entries to at most `maxTtlMs` from now. */
  shortenTtl(maxTtlMs: number): void {
    const deadline = Date.now() + maxTtlMs;
    for (const entry of this.store.values()) {
      if (entry.expiresAt > deadline) {
        entry.expiresAt = deadline;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CachedStorageProvider
// ---------------------------------------------------------------------------

function serializeKey(prefix: string, obj: unknown): string {
  return `${prefix}:${JSON.stringify(obj)}`;
}

export class CachedStorageProvider implements StorageProvider {
  private readonly provider: StorageProvider;
  private readonly byIdCache: LRUCache<OpsEvent | null>;
  private readonly queryCache: LRUCache<OpsEvent[]>;
  private readonly countCache: LRUCache<number>;
  private readonly aggregateCache: LRUCache<OpsStats>;

  readonly name: string;

  get mode(): 'local' | 'remote' {
    return this.provider.mode;
  }

  constructor(options: { provider: StorageProvider; cache?: LRUCacheOptions }) {
    this.provider = options.provider;
    this.name = `cached-${this.provider.name}`;

    const cacheOpts = options.cache ?? {};
    this.byIdCache = new LRUCache<OpsEvent | null>(cacheOpts);
    this.queryCache = new LRUCache<OpsEvent[]>(cacheOpts);
    this.countCache = new LRUCache<number>(cacheOpts);
    this.aggregateCache = new LRUCache<OpsStats>(cacheOpts);

    // Wire up optional checkpoint methods if the underlying provider supports them
    if (this.provider.saveChainCheckpoint) {
      this.saveChainCheckpoint = (checkpoint) => this.provider.saveChainCheckpoint!(checkpoint);
    }
    if (this.provider.getLastChainCheckpoint) {
      this.getLastChainCheckpoint = () => this.provider.getLastChainCheckpoint!();
    }
  }

  saveChainCheckpoint?: (checkpoint: { lastEventId: string; lastEventHash: string; eventsVerified: number }) => Promise<void>;
  getLastChainCheckpoint?: () => Promise<{ lastEventId: string; lastEventHash: string; eventsVerified: number; verifiedAt: string } | null>;

  // -- Delegated directly ------------------------------------------------

  initialize(): Promise<void> {
    return this.provider.initialize();
  }

  close(): Promise<void> {
    return this.provider.close();
  }

  vectorSearch(embedding: number[], options: VectorSearchOptions): Promise<SearchResult[]> {
    return this.provider.vectorSearch(embedding, options);
  }

  // -- Bypass cache (always hit provider) ---------------------------------

  getChain(since?: string): Promise<OpsEvent[]> {
    return this.provider.getChain(since);
  }

  prune(options: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }> {
    return this.provider.prune(options);
  }

  // -- Cached reads -------------------------------------------------------

  async getById(id: string): Promise<OpsEvent | null> {
    const cached = this.byIdCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.provider.getById(id);
    this.byIdCache.set(id, result);
    return result;
  }

  async query(options: QueryOptions): Promise<OpsEvent[]> {
    const key = serializeKey('query', options);
    const cached = this.queryCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.provider.query(options);
    this.queryCache.set(key, result);
    return result;
  }

  async count(options: QueryOptions): Promise<number> {
    const key = serializeKey('count', options);
    const cached = this.countCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.provider.count(options);
    this.countCache.set(key, result);
    return result;
  }

  async aggregate(options: AggregateOptions): Promise<OpsStats> {
    const key = serializeKey('aggregate', options);
    const cached = this.aggregateCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.provider.aggregate(options);
    this.aggregateCache.set(key, result);
    return result;
  }

  // -- Writes (invalidate derived caches) ---------------------------------

  async insert(event: OpsEvent): Promise<void> {
    await this.provider.insert(event);
    // Cache the newly inserted event by ID for immediate lookups
    this.byIdCache.set(event.id, event);
    // Invalidate query and count caches since list results changed
    this.queryCache.clear();
    this.countCache.clear();
    // Aggregate stats tolerate slight staleness — shorten TTL to 30s
    // instead of clearing, since aggregates are expensive to rebuild
    this.aggregateCache.shortenTtl(30_000);
  }

  // -- Cache management ---------------------------------------------------

  cacheStats(): CacheStats {
    const byId = this.byIdCache.stats();
    const query = this.queryCache.stats();
    const count = this.countCache.stats();
    const agg = this.aggregateCache.stats();

    const totalHits = byId.hits + query.hits + count.hits + agg.hits;
    const totalMisses = byId.misses + query.misses + count.misses + agg.misses;
    const total = totalHits + totalMisses;

    return {
      hits: totalHits,
      misses: totalMisses,
      hitRate: total === 0 ? 0 : totalHits / total,
      size: byId.size + query.size + count.size + agg.size,
      maxSize: byId.maxSize + query.maxSize + count.maxSize + agg.maxSize,
      evictions: byId.evictions + query.evictions + count.evictions + agg.evictions,
    };
  }

  clearCache(): void {
    this.byIdCache.clear();
    this.queryCache.clear();
    this.countCache.clear();
    this.aggregateCache.clear();
  }
}
