import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { OpsEventInput } from '../../src/memory/schema';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-store.db');

function makeEvent(overrides: Partial<OpsEventInput> = {}): OpsEventInput {
  return {
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'A test event for unit testing',
    affected_files: ['src/foo.ts'],
    tags: ['test'],
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

    store = new MemoryStore({
      provider: new SqliteProvider(TEST_DB),
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('capture()', () => {
    it('stores an event and returns it with id, hash, prev_hash', async () => {
      const event = await store.capture(makeEvent());
      expect(event.id).toBeTruthy();
      expect(event.hash).toHaveLength(64);
      expect(event.prev_hash).toHaveLength(64);
      expect(event.title).toBe('Test event');
    });

    it('rejects invalid events', async () => {
      await expect(store.capture(makeEvent({ title: '' }))).rejects.toThrow('Invalid event');
    });

    it('links events in a hash chain', async () => {
      const e1 = await store.capture(makeEvent({ title: 'First event' }));
      const e2 = await store.capture(makeEvent({ title: 'Second event' }));
      expect(e2.prev_hash).toBe(e1.hash);
    });
  });

  describe('list()', () => {
    it('returns events in descending timestamp order', async () => {
      await store.capture(makeEvent({ title: 'Event A', timestamp: '2026-01-01T00:00:00Z' }));
      await store.capture(makeEvent({ title: 'Event B', timestamp: '2026-01-02T00:00:00Z' }));
      const events = await store.list();
      expect(events).toHaveLength(2);
      expect(events[0].title).toBe('Event B');
      expect(events[1].title).toBe('Event A');
    });

    it('filters by event_type', async () => {
      await store.capture(makeEvent({ event_type: 'decision' }));
      await store.capture(makeEvent({ event_type: 'violation' }));
      const decisions = await store.list({ event_type: 'decision' });
      expect(decisions).toHaveLength(1);
      expect(decisions[0].event_type).toBe('decision');
    });

    it('filters by severity', async () => {
      await store.capture(makeEvent({ severity: 'low' }));
      await store.capture(makeEvent({ severity: 'critical' }));
      const critical = await store.list({ severity: 'critical' });
      expect(critical).toHaveLength(1);
    });

    it('paginates with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.capture(makeEvent({ title: `Event ${i}` }));
      }
      const page1 = await store.list({ limit: 2, offset: 0 });
      const page2 = await store.list({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });
  });

  describe('stats()', () => {
    it('returns aggregate counts', async () => {
      await store.capture(makeEvent({ event_type: 'decision', severity: 'low' }));
      await store.capture(makeEvent({ event_type: 'violation', severity: 'high' }));
      await store.capture(makeEvent({ event_type: 'decision', severity: 'low' }));

      const stats = await store.stats();
      expect(stats.total_events).toBe(3);
      expect(stats.by_type.decision).toBe(2);
      expect(stats.by_type.violation).toBe(1);
      expect(stats.by_severity.low).toBe(2);
      expect(stats.by_severity.high).toBe(1);
    });
  });

  describe('search()', () => {
    it('falls back to text matching with noop embeddings', async () => {
      await store.capture(makeEvent({ title: 'Auth login bug', detail: 'JWT token expired too early' }));
      await store.capture(makeEvent({ title: 'DB migration', detail: 'Added users table' }));

      const results = await store.search('JWT token');
      expect(results).toHaveLength(1);
      expect(results[0].event.title).toBe('Auth login bug');
    });
  });

  describe('verifyChain()', () => {
    it('returns valid for untampered chain', async () => {
      await store.capture(makeEvent({ title: 'Event 1' }));
      await store.capture(makeEvent({ title: 'Event 2' }));
      await store.capture(makeEvent({ title: 'Event 3' }));

      const result = await store.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.total_checked).toBe(3);
    });
  });
});
