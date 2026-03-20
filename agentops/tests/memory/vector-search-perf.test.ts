import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { OpsEvent, computeHash } from '../../src/memory/schema';
import { v4 as uuidv4 } from 'uuid';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-vector-search.db');

function makeFullEvent(overrides: Partial<OpsEvent> = {}): OpsEvent {
  const id = uuidv4();
  const base = {
    id,
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision' as const,
    severity: 'low' as const,
    skill: 'system' as const,
    title: 'Test event',
    detail: 'A test event for vector search',
    affected_files: ['src/foo.ts'],
    tags: ['test'],
    metadata: { source: 'test' },
    prev_hash: '0'.repeat(64),
    ...overrides,
  };
  const hash = computeHash(base);
  return { ...base, hash };
}

function randomEmbedding(dim: number): number[] {
  const emb: number[] = [];
  for (let i = 0; i < dim; i++) {
    emb.push(Math.random() * 2 - 1);
  }
  return emb;
}

describe('Vector Search (chunked)', () => {
  let provider: SqliteProvider;

  beforeEach(async () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

    provider = new SqliteProvider(TEST_DB);
    await provider.initialize();
  });

  afterEach(async () => {
    await provider.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('returns empty results for empty embedding table', async () => {
    const results = await provider.vectorSearch([1, 0, 0], { limit: 5, threshold: 0.1 });
    expect(results).toHaveLength(0);
  });

  it('returns correct results with cosine similarity', async () => {
    // Insert event with known embedding
    const targetEmb = [1, 0, 0, 0];
    const event1 = makeFullEvent({ title: 'Target event' });
    event1.embedding = targetEmb;
    await provider.insert(event1);

    // Insert event with orthogonal embedding (score ~ 0)
    const event2 = makeFullEvent({ title: 'Orthogonal event' });
    event2.embedding = [0, 1, 0, 0];
    await provider.insert(event2);

    // Insert event with similar embedding (score ~ 1)
    const event3 = makeFullEvent({ title: 'Similar event' });
    event3.embedding = [0.9, 0.1, 0, 0];
    await provider.insert(event3);

    const results = await provider.vectorSearch([1, 0, 0, 0], { limit: 10, threshold: 0.5 });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // Target and Similar should both be above threshold
    const titles = results.map((r) => r.event.title);
    expect(titles).toContain('Target event');
    expect(titles).toContain('Similar event');
    // Orthogonal should not appear
    expect(titles).not.toContain('Orthogonal event');
  });

  it('pre-filters by since timestamp', async () => {
    const oldDate = '2020-01-01T00:00:00Z';
    const newDate = '2026-01-01T00:00:00Z';

    const oldEvent = makeFullEvent({ title: 'Old event', timestamp: oldDate });
    oldEvent.embedding = [1, 0, 0];
    await provider.insert(oldEvent);

    const newEvent = makeFullEvent({ title: 'New event', timestamp: newDate });
    newEvent.embedding = [1, 0, 0];
    await provider.insert(newEvent);

    const results = await provider.vectorSearch([1, 0, 0], {
      limit: 10,
      threshold: 0.5,
      since: '2025-01-01T00:00:00Z',
    });

    expect(results).toHaveLength(1);
    expect(results[0].event.title).toBe('New event');
  });

  it('respects limit parameter', async () => {
    // Insert 5 events with identical embeddings
    for (let i = 0; i < 5; i++) {
      const event = makeFullEvent({ title: `Event ${i}` });
      event.embedding = [1, 0, 0];
      await provider.insert(event);
    }

    const results = await provider.vectorSearch([1, 0, 0], { limit: 2, threshold: 0.5 });
    expect(results).toHaveLength(2);
  });

  it('timestamp column in embeddings is populated on insert', async () => {
    const ts = '2026-03-15T12:00:00Z';
    const event = makeFullEvent({ timestamp: ts });
    event.embedding = [1, 0, 0];
    await provider.insert(event);

    // Directly query the embeddings table
    const db = new Database(TEST_DB, { readonly: true });
    const row = db.prepare('SELECT timestamp FROM ops_embeddings WHERE id = ?').get(event.id) as { timestamp: string };
    db.close();

    expect(row.timestamp).toBe(ts);
  });

  it('top-N maintenance works correctly (highest scores kept)', async () => {
    // Insert events with decreasing similarity
    const dim = 4;
    const queryEmb = [1, 0, 0, 0];

    // High similarity
    const highEvent = makeFullEvent({ title: 'High similarity' });
    highEvent.embedding = [0.95, 0.05, 0, 0];
    await provider.insert(highEvent);

    // Medium similarity
    const medEvent = makeFullEvent({ title: 'Medium similarity' });
    medEvent.embedding = [0.7, 0.3, 0, 0];
    await provider.insert(medEvent);

    // Low but above threshold
    const lowEvent = makeFullEvent({ title: 'Low similarity' });
    lowEvent.embedding = [0.6, 0.4, 0, 0];
    await provider.insert(lowEvent);

    const results = await provider.vectorSearch(queryEmb, { limit: 2, threshold: 0.5 });
    expect(results).toHaveLength(2);
    // Should be sorted by score descending
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    expect(results[0].event.title).toBe('High similarity');
  });
});
