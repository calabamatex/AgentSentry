import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { OpsEventInput } from '../../src/memory/schema';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-pruning.db');

function makeEvent(overrides: Partial<OpsEventInput> = {}): OpsEventInput {
  return {
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'A test event for pruning tests',
    affected_files: ['src/foo.ts'],
    tags: ['test'],
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('Pruning', () => {
  let provider: SqliteProvider;
  let store: MemoryStore;

  beforeEach(async () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

    provider = new SqliteProvider(TEST_DB);
    store = new MemoryStore({
      provider,
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('prunes events older than maxAgeDays', async () => {
    // Insert old events (400 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 400);
    await store.capture(makeEvent({ title: 'Old event 1', timestamp: oldDate.toISOString() }));
    await store.capture(makeEvent({ title: 'Old event 2', timestamp: oldDate.toISOString() }));

    // Insert recent events
    await store.capture(makeEvent({ title: 'New event 1' }));
    await store.capture(makeEvent({ title: 'New event 2' }));

    const result = await provider.prune({ maxAgeDays: 365 });
    expect(result.deleted).toBe(2);

    const remaining = await store.list({ limit: 100 });
    expect(remaining).toHaveLength(2);
    expect(remaining.every((e) => e.title.startsWith('New'))).toBe(true);
  });

  it('prunes events exceeding maxEvents (keeps newest)', async () => {
    // Insert 20 events with sequential timestamps
    for (let i = 0; i < 20; i++) {
      const ts = new Date(Date.now() + i * 1000).toISOString();
      await store.capture(makeEvent({ title: `Event ${i}`, timestamp: ts }));
    }

    const result = await provider.prune({ maxEvents: 10 });
    expect(result.deleted).toBe(10);

    const remaining = await store.list({ limit: 100 });
    expect(remaining).toHaveLength(10);

    // Verify the newest events are kept (events 10-19)
    const titles = remaining.map((e) => e.title);
    for (let i = 10; i < 20; i++) {
      expect(titles).toContain(`Event ${i}`);
    }
  });

  it('prune returns correct deleted count', async () => {
    await store.capture(makeEvent({ title: 'Only event' }));

    // No events to prune
    const result = await provider.prune({ maxEvents: 100 });
    expect(result.deleted).toBe(0);
  });

  it('prunes with both age and count constraints', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 400);

    // 3 old events
    for (let i = 0; i < 3; i++) {
      await store.capture(makeEvent({ title: `Old ${i}`, timestamp: oldDate.toISOString() }));
    }
    // 5 new events
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() + i * 1000).toISOString();
      await store.capture(makeEvent({ title: `New ${i}`, timestamp: ts }));
    }

    // Prune by age first (removes 3 old), then by count (keeps 3 of 5 remaining)
    const result = await provider.prune({ maxAgeDays: 365, maxEvents: 3 });
    expect(result.deleted).toBe(5); // 3 old + 2 excess new

    const remaining = await store.list({ limit: 100 });
    expect(remaining).toHaveLength(3);
  });

  it('prune via MemoryStore.prune() uses defaults from config', async () => {
    // Just verify the method works without errors
    const result = await store.prune();
    expect(result.deleted).toBe(0);
  });

  it('prune removes associated embeddings', async () => {
    // We use NoopEmbeddingProvider so no embeddings are actually stored,
    // but the SQL still runs without error. Verify prune completes.
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 400);
    await store.capture(makeEvent({ title: 'Old with embedding', timestamp: oldDate.toISOString() }));

    const result = await provider.prune({ maxAgeDays: 365 });
    expect(result.deleted).toBe(1);
  });
});
