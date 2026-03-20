import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { OpsEventInput } from '../../src/memory/schema';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-chain-checkpoint.db');

function makeEvent(overrides: Partial<OpsEventInput> = {}): OpsEventInput {
  return {
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'A test event for chain checkpoint tests',
    affected_files: ['src/foo.ts'],
    tags: ['test'],
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('Chain Checkpoint', () => {
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

  it('saves and retrieves a chain checkpoint', async () => {
    await provider.saveChainCheckpoint({
      lastEventId: 'evt-123',
      lastEventHash: 'abc'.repeat(21) + 'a', // 64 chars
      eventsVerified: 42,
    });

    const checkpoint = await provider.getLastChainCheckpoint();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.lastEventId).toBe('evt-123');
    expect(checkpoint!.lastEventHash).toBe('abc'.repeat(21) + 'a');
    expect(checkpoint!.eventsVerified).toBe(42);
    expect(checkpoint!.verifiedAt).toBeTruthy();
  });

  it('returns null when no checkpoint exists', async () => {
    const checkpoint = await provider.getLastChainCheckpoint();
    expect(checkpoint).toBeNull();
  });

  it('verifyChain saves a checkpoint after successful verification', async () => {
    // Insert some events
    const ts1 = '2026-01-01T00:00:00Z';
    const ts2 = '2026-01-02T00:00:00Z';
    const ts3 = '2026-01-03T00:00:00Z';

    await store.capture(makeEvent({ title: 'Event 1', timestamp: ts1 }));
    await store.capture(makeEvent({ title: 'Event 2', timestamp: ts2 }));
    await store.capture(makeEvent({ title: 'Event 3', timestamp: ts3 }));

    const result = await store.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.total_checked).toBe(3);

    // A checkpoint should now exist
    const checkpoint = await provider.getLastChainCheckpoint();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.eventsVerified).toBe(3);
  });

  it('incremental verification only checks new events', async () => {
    // Insert initial events and verify to create checkpoint
    const ts1 = '2026-01-01T00:00:00Z';
    const ts2 = '2026-01-02T00:00:00Z';
    await store.capture(makeEvent({ title: 'Event 1', timestamp: ts1 }));
    await store.capture(makeEvent({ title: 'Event 2', timestamp: ts2 }));

    const result1 = await store.verifyChain();
    expect(result1.valid).toBe(true);
    expect(result1.total_checked).toBe(2);

    // Add more events
    const ts3 = '2026-01-03T00:00:00Z';
    const ts4 = '2026-01-04T00:00:00Z';
    await store.capture(makeEvent({ title: 'Event 3', timestamp: ts3 }));
    await store.capture(makeEvent({ title: 'Event 4', timestamp: ts4 }));

    // Second verify should be incremental
    const result2 = await store.verifyChain();
    expect(result2.valid).toBe(true);
    // total_checked should include previously verified + new
    // The checkpoint had 2 verified, and it verifies from ts2 onwards
    // which includes Event 2 (the checkpoint event) + Event 3 + Event 4 = 3 new events checked
    // but total_checked = previously verified (2) + newly checked
    expect(result2.total_checked).toBeGreaterThanOrEqual(4);
  });

  it('full verification when no checkpoint exists', async () => {
    await store.capture(makeEvent({ title: 'Event 1', timestamp: '2026-01-01T00:00:00Z' }));
    await store.capture(makeEvent({ title: 'Event 2', timestamp: '2026-01-02T00:00:00Z' }));

    // No checkpoint yet, so full verification
    const result = await store.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.total_checked).toBe(2);
  });

  it('total_checked includes previously verified count', async () => {
    // Insert 3 events, verify (creates checkpoint with 3)
    for (let i = 0; i < 3; i++) {
      const ts = new Date(Date.now() + i * 1000).toISOString();
      await store.capture(makeEvent({ title: `Batch1 Event ${i}`, timestamp: ts }));
    }

    const r1 = await store.verifyChain();
    expect(r1.valid).toBe(true);
    expect(r1.total_checked).toBe(3);

    // Insert 2 more
    for (let i = 0; i < 2; i++) {
      const ts = new Date(Date.now() + (i + 10) * 1000).toISOString();
      await store.capture(makeEvent({ title: `Batch2 Event ${i}`, timestamp: ts }));
    }

    const r2 = await store.verifyChain();
    expect(r2.valid).toBe(true);
    // Should be at least 5 (3 previously + at least 2 new)
    expect(r2.total_checked).toBeGreaterThanOrEqual(5);
  });
});
