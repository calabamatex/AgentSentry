import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { BatchProcessor, batchInsert } from '../../src/memory/batch';
import { OpsEvent, OpsEventInput } from '../../src/memory/schema';
import { StorageProvider } from '../../src/memory/providers/storage-provider';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-batch.db');

function makeEvent(overrides: Partial<OpsEventInput> = {}): OpsEventInput {
  return {
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'A test event for batch testing',
    affected_files: ['src/foo.ts'],
    tags: ['test'],
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('BatchProcessor', () => {
  let store: MemoryStore;
  let processor: BatchProcessor;

  beforeEach(async () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

    store = new MemoryStore({
      provider: new SqliteProvider(TEST_DB),
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store.initialize();
    processor = new BatchProcessor({ store });
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  // ---------------------------------------------------------------------------
  // captureBatch()
  // ---------------------------------------------------------------------------
  describe('captureBatch()', () => {
    it('captures all valid events and returns them', async () => {
      const inputs = [
        makeEvent({ title: 'Event A' }),
        makeEvent({ title: 'Event B' }),
        makeEvent({ title: 'Event C' }),
      ];

      const result = await processor.captureBatch(inputs);

      expect(result.captured).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(result.captured[0].title).toBe('Event A');
      expect(result.captured[1].title).toBe('Event B');
      expect(result.captured[2].title).toBe('Event C');
    });

    it('returns totalTime > 0', async () => {
      const inputs = [makeEvent(), makeEvent()];
      const result = await processor.captureBatch(inputs);

      expect(result.totalTime).toBeGreaterThan(0);
    });

    it('maintains hash chain across batch (each prev_hash = prior hash)', async () => {
      const inputs = [
        makeEvent({ title: 'Chain 1' }),
        makeEvent({ title: 'Chain 2' }),
        makeEvent({ title: 'Chain 3' }),
      ];

      const result = await processor.captureBatch(inputs);
      const captured = result.captured;

      expect(captured).toHaveLength(3);
      // Each subsequent event's prev_hash should equal the prior event's hash
      expect(captured[1].prev_hash).toBe(captured[0].hash);
      expect(captured[2].prev_hash).toBe(captured[1].hash);
    });

    it('records errors for invalid events with correct index', async () => {
      const inputs = [
        makeEvent({ title: 'Valid event' }),
        makeEvent({ title: '' }), // invalid: empty title
        makeEvent({ title: 'Another valid' }),
      ];

      const result = await processor.captureBatch(inputs);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].index).toBe(1);
      expect(result.errors[0].error).toBeTruthy();
    });

    it('continues processing after errors (does not stop on first)', async () => {
      const inputs = [
        makeEvent({ title: '' }),       // invalid at index 0
        makeEvent({ title: 'Valid 1' }),
        makeEvent({ title: '' }),       // invalid at index 2
        makeEvent({ title: 'Valid 2' }),
      ];

      const result = await processor.captureBatch(inputs);

      expect(result.captured).toHaveLength(2);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].index).toBe(0);
      expect(result.errors[1].index).toBe(2);
      expect(result.captured[0].title).toBe('Valid 1');
      expect(result.captured[1].title).toBe('Valid 2');
    });

    it('empty input returns empty results', async () => {
      const result = await processor.captureBatch([]);

      expect(result.captured).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.totalTime).toBeGreaterThanOrEqual(0);
    });

    it('large batch (50+ events) succeeds', async () => {
      const inputs = Array.from({ length: 55 }, (_, i) =>
        makeEvent({ title: `Batch event ${i}` }),
      );

      const result = await processor.captureBatch(inputs);

      expect(result.captured).toHaveLength(55);
      expect(result.errors).toHaveLength(0);
      // Verify hash chain integrity across the whole batch
      for (let i = 1; i < result.captured.length; i++) {
        expect(result.captured[i].prev_hash).toBe(result.captured[i - 1].hash);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // searchBatch()
  // ---------------------------------------------------------------------------
  describe('searchBatch()', () => {
    it('runs multiple queries in parallel', async () => {
      await processor.captureBatch([
        makeEvent({ title: 'Auth login bug', detail: 'JWT expired' }),
        makeEvent({ title: 'DB migration', detail: 'Added users table' }),
        makeEvent({ title: 'Auth token refresh', detail: 'Token rotation' }),
      ]);

      const result = await processor.searchBatch([
        { query: 'JWT' },
        { query: 'migration' },
      ]);

      expect(result.results).toHaveLength(2);
    });

    it('returns results with timing info', async () => {
      await processor.captureBatch([makeEvent({ title: 'Some event' })]);

      const result = await processor.searchBatch([{ query: 'Some' }]);

      expect(result.totalTime).toBeGreaterThan(0);
      expect(result.results).toBeDefined();
    });

    it('each result has correct query string', async () => {
      await processor.captureBatch([makeEvent({ title: 'Test data' })]);

      const queries = [
        { query: 'alpha' },
        { query: 'beta' },
        { query: 'gamma' },
      ];
      const result = await processor.searchBatch(queries);

      expect(result.results).toHaveLength(3);
      expect(result.results[0].query).toBe('alpha');
      expect(result.results[1].query).toBe('beta');
      expect(result.results[2].query).toBe('gamma');
    });

    it('empty queries returns empty results', async () => {
      const result = await processor.searchBatch([]);

      expect(result.results).toHaveLength(0);
      expect(result.totalTime).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------------
  // listBatch()
  // ---------------------------------------------------------------------------
  describe('listBatch()', () => {
    it('runs multiple list queries in parallel', async () => {
      await processor.captureBatch([
        makeEvent({ event_type: 'decision', severity: 'low' }),
        makeEvent({ event_type: 'violation', severity: 'high' }),
        makeEvent({ event_type: 'decision', severity: 'critical' }),
      ]);

      const results = await processor.listBatch([
        { event_type: 'decision' },
        { event_type: 'violation' },
      ]);

      expect(results).toHaveLength(2);
    });

    it('filters correctly per query options', async () => {
      await processor.captureBatch([
        makeEvent({ event_type: 'decision', severity: 'low' }),
        makeEvent({ event_type: 'violation', severity: 'high' }),
        makeEvent({ event_type: 'decision', severity: 'critical' }),
      ]);

      const results = await processor.listBatch([
        { event_type: 'decision' },
        { severity: 'high' },
      ]);

      expect(results[0]).toHaveLength(2);
      results[0].forEach((e) => expect(e.event_type).toBe('decision'));

      expect(results[1]).toHaveLength(1);
      expect(results[1][0].severity).toBe('high');
    });

    it('returns correct number of result arrays', async () => {
      await processor.captureBatch([makeEvent()]);

      const options = [{}, {}, {}, {}];
      const results = await processor.listBatch(options);

      expect(results).toHaveLength(4);
      results.forEach((r) => expect(Array.isArray(r)).toBe(true));
    });
  });
});

// ---------------------------------------------------------------------------
// batchInsert()
// ---------------------------------------------------------------------------
describe('batchInsert()', () => {
  it('inserts events via provider.insert()', async () => {
    const insertMock = vi.fn().mockResolvedValue(undefined);
    const mockProvider: Partial<StorageProvider> = {
      insert: insertMock,
    };

    const events: OpsEvent[] = [
      {
        id: 'evt-1',
        timestamp: new Date().toISOString(),
        session_id: 'sess-1',
        agent_id: 'agent-1',
        event_type: 'decision',
        severity: 'low',
        skill: 'system',
        title: 'Event 1',
        detail: 'Detail 1',
        affected_files: [],
        tags: [],
        metadata: {},
        hash: 'a'.repeat(64),
        prev_hash: '0'.repeat(64),
      },
      {
        id: 'evt-2',
        timestamp: new Date().toISOString(),
        session_id: 'sess-1',
        agent_id: 'agent-1',
        event_type: 'violation',
        severity: 'high',
        skill: 'system',
        title: 'Event 2',
        detail: 'Detail 2',
        affected_files: [],
        tags: [],
        metadata: {},
        hash: 'b'.repeat(64),
        prev_hash: 'a'.repeat(64),
      },
    ];

    await batchInsert(mockProvider as StorageProvider, events);

    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenNthCalledWith(1, events[0]);
    expect(insertMock).toHaveBeenNthCalledWith(2, events[1]);
  });

  it('empty array is no-op', async () => {
    const insertMock = vi.fn().mockResolvedValue(undefined);
    const mockProvider: Partial<StorageProvider> = {
      insert: insertMock,
    };

    await batchInsert(mockProvider as StorageProvider, []);

    expect(insertMock).not.toHaveBeenCalled();
  });
});
