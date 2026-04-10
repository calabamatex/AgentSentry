/**
 * Atomic lock concurrency tests — validates that concurrent lock acquisitions
 * are safe when using a StorageProvider with atomicLockAcquire.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { AgentCoordinator } from '../../src/coordination/coordinator';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-atomic-locks.db');

function createStore(): { store: MemoryStore; provider: SqliteProvider } {
  const provider = new SqliteProvider(TEST_DB);
  const store = new MemoryStore({
    provider,
    embeddingProvider: new NoopEmbeddingProvider(),
  });
  return { store, provider };
}

describe('Atomic Locks', () => {
  let store: MemoryStore;
  let provider: SqliteProvider;

  beforeEach(async () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const result = createStore();
    store = result.store;
    provider = result.provider;
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    try { fs.unlinkSync(TEST_DB); } catch { /* ignore */ }
  });

  it('only one agent acquires when two race for the same lock', async () => {
    const agent1 = new AgentCoordinator({
      agentId: 'agent-1',
      agentName: 'Agent One',
      store,
      provider,
      heartbeatIntervalMs: 100_000,
      lockTimeoutMs: 10_000,
    });

    const agent2 = new AgentCoordinator({
      agentId: 'agent-2',
      agentName: 'Agent Two',
      store,
      provider,
      heartbeatIntervalMs: 100_000,
      lockTimeoutMs: 10_000,
    });

    // Both try to acquire the same resource concurrently
    const [result1, result2] = await Promise.all([
      agent1.acquireLock('shared-resource'),
      agent2.acquireLock('shared-resource'),
    ]);

    // Exactly one should succeed
    expect(result1 !== result2).toBe(true);
    expect([result1, result2]).toContain(true);
    expect([result1, result2]).toContain(false);
  });

  it('same agent can re-acquire own lock (re-entrant)', async () => {
    const agent = new AgentCoordinator({
      agentId: 'agent-1',
      agentName: 'Agent One',
      store,
      provider,
      heartbeatIntervalMs: 100_000,
      lockTimeoutMs: 10_000,
    });

    const first = await agent.acquireLock('my-resource');
    const second = await agent.acquireLock('my-resource');

    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it('lock can be released and re-acquired by another agent', async () => {
    const agent1 = new AgentCoordinator({
      agentId: 'agent-1',
      agentName: 'Agent One',
      store,
      provider,
      heartbeatIntervalMs: 100_000,
      lockTimeoutMs: 10_000,
    });

    const agent2 = new AgentCoordinator({
      agentId: 'agent-2',
      agentName: 'Agent Two',
      store,
      provider,
      heartbeatIntervalMs: 100_000,
      lockTimeoutMs: 10_000,
    });

    // Agent 1 acquires
    expect(await agent1.acquireLock('resource-a')).toBe(true);

    // Agent 2 cannot acquire
    expect(await agent2.acquireLock('resource-a')).toBe(false);

    // Agent 1 releases
    expect(await agent1.releaseLock('resource-a')).toBe(true);

    // Agent 2 can now acquire
    expect(await agent2.acquireLock('resource-a')).toBe(true);
  });

  it('expired locks are cleaned up and can be re-acquired', async () => {
    const agent1 = new AgentCoordinator({
      agentId: 'agent-1',
      agentName: 'Agent One',
      store,
      provider,
      heartbeatIntervalMs: 100_000,
      lockTimeoutMs: 1, // 1ms TTL — expires immediately
    });

    const agent2 = new AgentCoordinator({
      agentId: 'agent-2',
      agentName: 'Agent Two',
      store,
      provider,
      heartbeatIntervalMs: 100_000,
      lockTimeoutMs: 10_000,
    });

    // Agent 1 acquires with 1ms TTL
    expect(await agent1.acquireLock('expiring-resource')).toBe(true);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Agent 2 can now acquire (expired lock cleaned up)
    expect(await agent2.acquireLock('expiring-resource')).toBe(true);
  });
});
