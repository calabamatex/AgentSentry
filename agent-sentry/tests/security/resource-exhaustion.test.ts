/**
 * Resource exhaustion / DoS attack vectors.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { createRateLimiter } from '../../src/mcp/auth';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-security-exhaustion.db');

function createStore(): MemoryStore {
  return new MemoryStore({
    provider: new SqliteProvider(TEST_DB),
    embeddingProvider: new NoopEmbeddingProvider(),
  });
}

function eventBase() {
  return {
    timestamp: new Date().toISOString(),
    session_id: 'test-session',
    agent_id: 'test-agent',
  };
}

describe('Resource exhaustion', () => {
  let store: MemoryStore;

  afterEach(async () => {
    if (store) await store.close();
  });

  it('handles extremely large event detail without crashing', async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = createStore();
    await store.initialize();

    const largeDetail = 'x'.repeat(1_000_000); // 1MB string (not 10MB to keep test fast)

    const event = await store.capture({
      ...eventBase(),
      event_type: 'decision',
      severity: 'low',
      skill: 'context_health',
      title: 'Large detail test',
      detail: largeDetail,
      affected_files: [],
      tags: [],
      metadata: {},
    });

    expect(event.id).toBeDefined();
    expect(event.detail.length).toBe(1_000_000);
  });

  it('handles many tags without crashing', async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = createStore();
    await store.initialize();

    const manyTags = Array.from({ length: 1000 }, (_, i) => `tag-${i}`);

    const event = await store.capture({
      ...eventBase(),
      event_type: 'decision',
      severity: 'low',
      skill: 'context_health',
      title: 'Many tags test',
      detail: 'Test event with many tags',
      affected_files: [],
      tags: manyTags,
      metadata: {},
    });

    expect(event.id).toBeDefined();
    expect(event.tags.length).toBe(1000);
  });

  it('handles deeply nested metadata without crashing', async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    store = createStore();
    await store.initialize();

    // Build a 100-level deep object (not 1000 — JSON.stringify has limits)
    let nested: Record<string, any> = { value: 'leaf' };
    for (let i = 0; i < 100; i++) {
      nested = { [`level_${i}`]: nested };
    }

    const event = await store.capture({
      ...eventBase(),
      event_type: 'decision',
      severity: 'low',
      skill: 'context_health',
      title: 'Deep nesting test',
      detail: 'Test event with deeply nested metadata',
      affected_files: [],
      tags: [],
      metadata: nested,
    });

    expect(event.id).toBeDefined();
  });
});

describe('Rate limiter DoS protection', () => {
  it('blocks flood from single IP', () => {
    const limiter = createRateLimiter(10, 60000);
    const ip = '192.168.1.1';

    // First 10 should pass
    for (let i = 0; i < 10; i++) {
      expect(limiter.check(ip)).toBe(true);
    }

    // Subsequent should be blocked
    for (let i = 0; i < 100; i++) {
      expect(limiter.check(ip)).toBe(false);
    }
  });

  it('store size limit prevents memory exhaustion', () => {
    const limiter = createRateLimiter(1, 60000);

    // Simulate many unique IPs (the rate limiter has a 10k store size limit)
    let blockedByLimit = false;
    for (let i = 0; i < 15000; i++) {
      const result = limiter.check(`10.0.${Math.floor(i / 256)}.${i % 256}`);
      if (!result) {
        blockedByLimit = true;
        break;
      }
    }

    // Eventually, the store limit should kick in
    // (either via the 10k limit or via rate limiting)
    expect(blockedByLimit).toBe(true);
  });
});
