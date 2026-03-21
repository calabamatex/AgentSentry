/**
 * cached-provider.ts — Illustrative example showing CachedStorageProvider usage.
 *
 * Demonstrates: wrapping a base provider with LRU caching and inspecting cache stats.
 * Run: npx ts-node docs/examples/cached-provider.ts
 */

import { MemoryStore, createProvider, CachedStorageProvider, LRUCache } from 'agentops';

async function main() {
  // Create the base SQLite provider
  const baseProvider = createProvider({
    provider: 'sqlite',
    database_path: './cache-example.db',
  });

  // Wrap it with caching (1000 entries, 5-minute TTL)
  const cachedProvider = new CachedStorageProvider({
    provider: baseProvider,
    cache: { maxSize: 1000, defaultTtl: 300_000 },
  });

  // Use the cached provider in a MemoryStore
  const store = new MemoryStore({ provider: cachedProvider });
  await store.initialize();

  // Capture a few events
  for (let i = 0; i < 5; i++) {
    await store.capture({
      timestamp: new Date().toISOString(),
      session_id: 'cache-demo',
      agent_id: 'agent-1',
      event_type: 'decision',
      severity: 'low',
      skill: 'save_points',
      title: `Cache test event ${i}`,
      detail: `Testing cache behavior with event ${i}`,
      affected_files: [],
      tags: ['cache-test'],
      metadata: {},
    });
  }

  // Query twice to see cache hits on the second call
  await store.list({ limit: 10 });
  await store.list({ limit: 10 });
  await store.stats();
  await store.stats();

  // Standalone LRU cache usage
  const cache = new LRUCache<string>({ maxSize: 100, defaultTtl: 60_000 });
  cache.set('key-1', 'value-1');
  cache.get('key-1'); // hit
  cache.get('key-2'); // miss

  const stats = cache.stats();
  console.log('LRU cache stats:', stats);
  // { hits: 1, misses: 1, hitRate: 0.5, size: 1, maxSize: 100, evictions: 0 }

  await store.close();
}

main().catch(console.error);
