import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SqliteProvider } from '../../../src/memory/providers/sqlite-provider';
import { OpsEvent } from '../../../src/memory/schema';
import { computeHash } from '../../../src/memory/schema';

const TEST_DB = path.resolve(__dirname, '../../fixtures/test-sqlite.db');

function makeOpsEvent(overrides: Partial<OpsEvent> = {}): OpsEvent {
  const base = {
    id: 'test-' + Math.random().toString(36).slice(2, 10),
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision' as const,
    severity: 'low' as const,
    skill: 'system' as const,
    title: 'Test event',
    detail: 'Test detail',
    affected_files: ['src/test.ts'],
    tags: ['test'],
    metadata: {},
    prev_hash: '0'.repeat(64),
    ...overrides,
  };
  const hash = overrides.hash ?? computeHash(base);
  return { ...base, hash };
}

describe('SqliteProvider', () => {
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

  it('has name "sqlite" and mode "local"', () => {
    expect(provider.name).toBe('sqlite');
    expect(provider.mode).toBe('local');
  });

  it('inserts and retrieves by ID', async () => {
    const event = makeOpsEvent({ id: 'evt-1' });
    await provider.insert(event);
    const retrieved = await provider.getById('evt-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test event');
    expect(retrieved!.affected_files).toEqual(['src/test.ts']);
  });

  it('returns null for missing ID', async () => {
    const result = await provider.getById('nonexistent');
    expect(result).toBeNull();
  });

  it('queries with filters', async () => {
    await provider.insert(makeOpsEvent({ id: 'e1', event_type: 'decision' }));
    await provider.insert(makeOpsEvent({ id: 'e2', event_type: 'violation' }));
    await provider.insert(makeOpsEvent({ id: 'e3', event_type: 'decision' }));

    const decisions = await provider.query({ event_type: 'decision' });
    expect(decisions).toHaveLength(2);
  });

  it('counts with filters', async () => {
    await provider.insert(makeOpsEvent({ id: 'e1', severity: 'low' }));
    await provider.insert(makeOpsEvent({ id: 'e2', severity: 'high' }));

    const count = await provider.count({ severity: 'low' });
    expect(count).toBe(1);
  });

  it('returns chain in ascending order', async () => {
    await provider.insert(makeOpsEvent({ id: 'e1', timestamp: '2026-01-01T00:00:00Z' }));
    await provider.insert(makeOpsEvent({ id: 'e2', timestamp: '2026-01-02T00:00:00Z' }));

    const chain = await provider.getChain();
    expect(chain).toHaveLength(2);
    expect(chain[0].id).toBe('e1');
    expect(chain[1].id).toBe('e2');
  });

  it('aggregates stats correctly', async () => {
    await provider.insert(makeOpsEvent({ id: 'e1', event_type: 'decision', severity: 'low', skill: 'system' }));
    await provider.insert(makeOpsEvent({ id: 'e2', event_type: 'violation', severity: 'high', skill: 'save_points' }));

    const stats = await provider.aggregate({});
    expect(stats.total_events).toBe(2);
    expect(stats.by_type.decision).toBe(1);
    expect(stats.by_type.violation).toBe(1);
    expect(stats.by_severity.low).toBe(1);
    expect(stats.by_severity.high).toBe(1);
  });

  it('stores and searches embeddings', async () => {
    const embedding = new Array(384).fill(0).map((_, i) => Math.sin(i));
    const event = makeOpsEvent({ id: 'emb-1', embedding });
    await provider.insert(event);

    const results = await provider.vectorSearch(embedding, { limit: 5, threshold: 0.9 });
    expect(results).toHaveLength(1);
    expect(results[0].event.id).toBe('emb-1');
    expect(results[0].score).toBeGreaterThan(0.9);
  });
});
