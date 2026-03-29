import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { LRUCache, CachedStorageProvider, CacheStats } from '../../src/memory/cache';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { OpsEvent, OpsEventInput } from '../../src/memory/schema';
import { createHash } from 'crypto';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-cache.db');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let eventCounter = 0;

function makeOpsEvent(overrides: Partial<OpsEvent> = {}): OpsEvent {
  eventCounter++;
  const id = overrides.id ?? `evt-${eventCounter}-${Date.now()}`;
  const prev_hash = overrides.prev_hash ?? '0'.repeat(64);
  const content = `${id}|${prev_hash}`;
  const hash = overrides.hash ?? createHash('sha256').update(content).digest('hex');

  return {
    id,
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'A test event for cache testing',
    affected_files: ['src/foo.ts'],
    tags: ['test'],
    metadata: { source: 'test' },
    hash,
    prev_hash,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// LRUCache
// ---------------------------------------------------------------------------

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>({ maxSize: 5, defaultTtl: 60_000 });
  });

  it('get() returns undefined for missing keys and counts a miss', () => {
    const result = cache.get('nonexistent');
    expect(result).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  it('set() and get() round-trip', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('get() moves item to most recently used position', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    // Access 'a' to move it to end
    cache.get('a');

    // Fill cache to capacity and add one more to trigger eviction
    cache.set('d', '4');
    cache.set('e', '5');
    // Now at capacity (5). Adding one more should evict 'b' (the oldest).
    cache.set('f', '6');

    expect(cache.get('b')).toBeUndefined(); // evicted
    expect(cache.get('a')).toBe('1'); // still present because it was accessed
  });

  it('expired entries return undefined on get()', () => {
    cache.set('short-lived', 'temp', 1); // 1ms TTL

    // Wait just enough for expiration
    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    expect(cache.get('short-lived')).toBeUndefined();
    expect(cache.stats().misses).toBe(1);
  });

  it('expired entries return false on has()', () => {
    cache.set('ephemeral', 'gone', 1); // 1ms TTL

    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    expect(cache.has('ephemeral')).toBe(false);
  });

  it('set() evicts oldest entry when maxSize exceeded', () => {
    // maxSize is 5
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.set('d', '4');
    cache.set('e', '5');

    // This should evict 'a'
    cache.set('f', '6');

    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(5);
    expect(cache.stats().evictions).toBe(1);
  });

  it('delete() removes entry', () => {
    cache.set('doomed', 'value');
    expect(cache.delete('doomed')).toBe(true);
    expect(cache.get('doomed')).toBeUndefined();
  });

  it('clear() empties cache', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('size getter reflects current entries', () => {
    expect(cache.size).toBe(0);
    cache.set('a', '1');
    expect(cache.size).toBe(1);
    cache.set('b', '2');
    expect(cache.size).toBe(2);
    cache.delete('a');
    expect(cache.size).toBe(1);
  });

  it('stats() returns correct hit/miss/eviction counts', () => {
    cache.set('a', '1');
    cache.get('a'); // hit
    cache.get('b'); // miss
    cache.get('c'); // miss

    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(2);
    expect(s.hitRate).toBeCloseTo(1 / 3);
    expect(s.size).toBe(1);
    expect(s.maxSize).toBe(5);
    expect(s.evictions).toBe(0);
  });

  it('resetStats() zeros all counters', () => {
    cache.set('a', '1');
    cache.get('a');
    cache.get('missing');

    cache.resetStats();

    const s = cache.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.evictions).toBe(0);
    expect(s.hitRate).toBe(0);
  });

  it('custom TTL per entry overrides default', () => {
    // Default TTL is 60s, but set a 1ms TTL for this entry
    cache.set('custom', 'short', 1);
    // And a normal entry
    cache.set('normal', 'long');

    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    expect(cache.get('custom')).toBeUndefined();
    expect(cache.get('normal')).toBe('long');
  });

  it('LRU eviction order is correct (oldest first)', () => {
    // Fill to capacity
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.set('d', '4');
    cache.set('e', '5');

    // Access 'a' and 'b' to make them recently used
    cache.get('a');
    cache.get('b');

    // Add two more, should evict 'c' then 'd' (the oldest untouched)
    cache.set('f', '6');
    cache.set('g', '7');

    expect(cache.get('c')).toBeUndefined();
    expect(cache.get('d')).toBeUndefined();
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBe('2');
    expect(cache.get('e')).toBe('5');
  });

  it('has() returns true for non-expired entries', () => {
    cache.set('present', 'here');
    expect(cache.has('present')).toBe(true);
  });

  it('has() returns false for absent keys', () => {
    expect(cache.has('ghost')).toBe(false);
  });

  it('multiple evictions tracked correctly', () => {
    // maxSize is 5. Insert 8 items to cause 3 evictions.
    for (let i = 0; i < 8; i++) {
      cache.set(`key-${i}`, `val-${i}`);
    }

    expect(cache.stats().evictions).toBe(3);
    expect(cache.size).toBe(5);
  });

  it('stats() hitRate is 0 when no gets have occurred', () => {
    expect(cache.stats().hitRate).toBe(0);
  });

  it('overwriting an existing key does not increase size', () => {
    cache.set('x', 'v1');
    cache.set('x', 'v2');
    expect(cache.size).toBe(1);
    expect(cache.get('x')).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// CachedStorageProvider
// ---------------------------------------------------------------------------

describe('CachedStorageProvider', () => {
  let provider: SqliteProvider;
  let cached: CachedStorageProvider;

  beforeEach(async () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

    provider = new SqliteProvider(TEST_DB);
    cached = new CachedStorageProvider({ provider, cache: { maxSize: 100, defaultTtl: 60_000 } });
    await cached.initialize();
  });

  afterEach(async () => {
    await cached.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('name returns cached-${provider.name}', () => {
    expect(cached.name).toBe('cached-sqlite');
  });

  it('mode delegates to provider', () => {
    expect(cached.mode).toBe('local');
  });

  it('getById() caches result on first call', async () => {
    const event = makeOpsEvent({ id: 'cache-test-1' });
    await cached.insert(event);

    const result = await cached.getById('cache-test-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('cache-test-1');

    // insert() pre-caches the event by ID, so getById is a hit
    const stats = cached.cacheStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
  });

  it('getById() returns cached result on second call (verify via stats)', async () => {
    const event = makeOpsEvent({ id: 'cache-test-2' });
    await cached.insert(event);

    // First call - cache miss
    await cached.getById('cache-test-2');
    const statsAfterFirst = cached.cacheStats();
    const missesAfterFirst = statsAfterFirst.misses;

    // Second call - should be a cache hit
    const result = await cached.getById('cache-test-2');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('cache-test-2');

    const statsAfterSecond = cached.cacheStats();
    // Misses should not have increased
    expect(statsAfterSecond.misses).toBe(missesAfterFirst);
    // Hits should have increased
    expect(statsAfterSecond.hits).toBeGreaterThan(statsAfterFirst.hits);
  });

  it('query() caches by serialized options', async () => {
    const event = makeOpsEvent();
    await cached.insert(event);

    const opts = { event_type: 'decision' as const };

    // First call - miss
    const r1 = await cached.query(opts);
    const statsAfterFirst = cached.cacheStats();

    // Second call with same opts - hit
    const r2 = await cached.query(opts);
    const statsAfterSecond = cached.cacheStats();

    expect(r1).toEqual(r2);
    expect(statsAfterSecond.hits).toBeGreaterThan(statsAfterFirst.hits);
  });

  it('count() caches by serialized options', async () => {
    const event = makeOpsEvent();
    await cached.insert(event);

    const opts = { event_type: 'decision' as const };

    const c1 = await cached.count(opts);
    const statsAfterFirst = cached.cacheStats();

    const c2 = await cached.count(opts);
    const statsAfterSecond = cached.cacheStats();

    expect(c1).toBe(c2);
    expect(statsAfterSecond.hits).toBeGreaterThan(statsAfterFirst.hits);
  });

  it('aggregate() caches by serialized options', async () => {
    const event = makeOpsEvent();
    await cached.insert(event);

    const opts = { session_id: 'sess-1' };

    const a1 = await cached.aggregate(opts);
    const statsAfterFirst = cached.cacheStats();

    const a2 = await cached.aggregate(opts);
    const statsAfterSecond = cached.cacheStats();

    expect(a1).toEqual(a2);
    expect(statsAfterSecond.hits).toBeGreaterThan(statsAfterFirst.hits);
  });

  it('insert() invalidates query/count/aggregate caches but not byId cache', async () => {
    const event1 = makeOpsEvent({ id: 'ins-test-1' });
    await cached.insert(event1);

    // Populate all caches
    await cached.getById('ins-test-1');
    await cached.query({ event_type: 'decision' });
    await cached.count({ event_type: 'decision' });
    await cached.aggregate({});

    const sizeBeforeInsert = cached.cacheStats().size;
    expect(sizeBeforeInsert).toBeGreaterThanOrEqual(4);

    // Insert invalidates query/count/aggregate caches
    const event2 = makeOpsEvent({ id: 'ins-test-2' });
    await cached.insert(event2);

    const sizeAfterInsert = cached.cacheStats().size;
    // byId cache should still have its entry, but query/count/aggregate cleared
    expect(sizeAfterInsert).toBeLessThan(sizeBeforeInsert);

    // byId for event1 should still be cached (hit)
    const statsBeforeById = cached.cacheStats();
    await cached.getById('ins-test-1');
    const statsAfterById = cached.cacheStats();
    expect(statsAfterById.hits).toBeGreaterThan(statsBeforeById.hits);
  });

  it('getChain() bypasses cache (always hits provider)', async () => {
    const event = makeOpsEvent();
    await cached.insert(event);

    const chain1 = await cached.getChain();
    const chain2 = await cached.getChain();

    // Both calls should return results; cache size should not grow for chain calls
    expect(chain1.length).toBeGreaterThanOrEqual(1);
    expect(chain2.length).toEqual(chain1.length);
  });

  it('prune() bypasses cache', async () => {
    const event = makeOpsEvent();
    await cached.insert(event);

    const result = await cached.prune({ maxEvents: 1000 });
    expect(result).toHaveProperty('deleted');
    expect(typeof result.deleted).toBe('number');
  });

  it('vectorSearch() delegates directly to provider', async () => {
    // vectorSearch with empty embedding should not throw
    const results = await cached.vectorSearch([], { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
  });

  it('initialize() delegates to provider', async () => {
    // We already called initialize in beforeEach. Calling again should not throw.
    await expect(cached.initialize()).resolves.toBeUndefined();
  });

  it('close() delegates to provider', async () => {
    // Create a separate instance to test close without interfering with afterEach
    const db2 = path.resolve(__dirname, '../fixtures/test-cache-close.db');
    if (fs.existsSync(db2)) fs.unlinkSync(db2);

    const p2 = new SqliteProvider(db2);
    const c2 = new CachedStorageProvider({ provider: p2 });
    await c2.initialize();
    await expect(c2.close()).resolves.toBeUndefined();

    if (fs.existsSync(db2)) fs.unlinkSync(db2);
  });

  it('cacheStats() aggregates across all internal caches', async () => {
    const event = makeOpsEvent({ id: 'stats-agg-1' });
    await cached.insert(event);

    // Trigger misses across different caches
    await cached.getById('stats-agg-1');
    await cached.query({});
    await cached.count({});
    await cached.aggregate({});

    const stats = cached.cacheStats();
    // 3 misses from query/count/aggregate; getById is a hit (pre-cached by insert)
    expect(stats.misses).toBe(3);
    expect(stats.size).toBe(4); // 1 byId (from insert) + 3 from query/count/aggregate
    expect(stats.hits).toBe(1);
    expect(stats.hitRate).toBe(0.25);
    expect(stats.maxSize).toBe(400); // 4 caches x 100 each
  });

  it('clearCache() empties all caches', async () => {
    const event = makeOpsEvent({ id: 'clear-test' });
    await cached.insert(event);

    // Populate caches
    await cached.getById('clear-test');
    await cached.query({});
    await cached.count({});
    await cached.aggregate({});

    expect(cached.cacheStats().size).toBeGreaterThan(0);

    cached.clearCache();

    expect(cached.cacheStats().size).toBe(0);
  });

  it('different query options produce separate cache entries', async () => {
    const event = makeOpsEvent();
    await cached.insert(event);

    await cached.query({ event_type: 'decision' });
    await cached.query({ severity: 'low' });

    const stats = cached.cacheStats();
    expect(stats.misses).toBe(2);
    expect(stats.size).toBe(3); // 1 byId (from insert) + 2 query entries
  });
});
