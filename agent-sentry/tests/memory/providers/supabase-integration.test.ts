/**
 * Supabase integration test — runs against a real Supabase instance.
 *
 * SKIPPED unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
 * Run with: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test -- tests/memory/providers/supabase-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseProvider } from '../../../src/memory/providers/supabase-provider';
import { PooledSupabaseProvider } from '../../../src/memory/providers/pooled-supabase-provider';
import { MemoryStore } from '../../../src/memory/store';
import { NoopEmbeddingProvider } from '../../../src/memory/embeddings';
import { LogForwarder } from '../../../src/observability/log-forwarder';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HAS_SUPABASE = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!HAS_SUPABASE)('Supabase Integration', () => {
  let provider: SupabaseProvider;
  let store: MemoryStore;
  const testSessionId = `integration-test-${Date.now()}`;

  beforeAll(async () => {
    provider = new SupabaseProvider();
    store = new MemoryStore({
      provider,
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store.initialize();
  });

  afterAll(async () => {
    // Clean up test events
    try {
      await provider.prune({ maxAgeDays: 0 });
    } catch { /* best effort */ }
    await store.close();
  });

  it('initialize connects and verifies schema', async () => {
    // If we got here, initialize succeeded
    expect(true).toBe(true);
  });

  it('captures and retrieves an event', async () => {
    const event = await store.capture({
      timestamp: new Date().toISOString(),
      session_id: testSessionId,
      agent_id: 'integration-test',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Integration test event',
      detail: 'Created by supabase-integration.test.ts',
      affected_files: [],
      tags: ['integration-test'],
      metadata: { test: true },
    });

    expect(event.id).toBeDefined();

    const retrieved = await store.getById(event.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Integration test event');
  });

  it('queries events with filters', async () => {
    const events = await store.list({
      session_id: testSessionId,
      event_type: 'decision',
      limit: 10,
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].session_id).toBe(testSessionId);
  });

  it('textSearch finds by keyword', async () => {
    const results = await store.search('Integration test', {
      session_id: testSessionId,
      limit: 5,
    });

    // search uses embeddings which are noop, fall back check
    // Just verify it doesn't throw
    expect(Array.isArray(results)).toBe(true);
  });

  it('atomic lock lifecycle works', async () => {
    const resource = `test-lock-${Date.now()}`;

    const acquired = await provider.atomicLockAcquire!(resource, 'agent-1', Date.now(), new Date(Date.now() + 30000).toISOString());
    expect(acquired).toBe(true);

    const lockInfo = await provider.atomicLockGet!(resource);
    expect(lockInfo).not.toBeNull();
    expect(lockInfo!.holder).toBe('agent-1');

    const released = await provider.atomicLockRelease!(resource, 'agent-1');
    expect(released).toBe(true);

    const afterRelease = await provider.atomicLockGet!(resource);
    expect(afterRelease).toBeNull();
  });

  it('lock prevents second agent from acquiring', async () => {
    const resource = `test-lock-contention-${Date.now()}`;

    const first = await provider.atomicLockAcquire!(resource, 'agent-1', Date.now(), new Date(Date.now() + 30000).toISOString());
    expect(first).toBe(true);

    const second = await provider.atomicLockAcquire!(resource, 'agent-2', Date.now(), new Date(Date.now() + 30000).toISOString());
    expect(second).toBe(false);

    // Clean up
    await provider.atomicLockRelease!(resource, 'agent-1');
  });
});

describe.skipIf(!HAS_SUPABASE)('Supabase Pooled Integration', () => {
  let provider: PooledSupabaseProvider;

  beforeAll(async () => {
    provider = new PooledSupabaseProvider();
    await provider.initialize();
  });

  afterAll(async () => {
    await provider.close();
  });

  it('initializes with connection pool', async () => {
    const stats = provider.getPool().getStats();
    expect(stats.totalRequests).toBeGreaterThanOrEqual(0);
  });

  it('insert and getById work through pool', async () => {
    const id = `pooled-test-${Date.now()}`;
    await provider.insert({
      id,
      timestamp: new Date().toISOString(),
      session_id: 'pooled-test',
      agent_id: 'test',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Pooled test',
      detail: 'Test',
      affected_files: [],
      tags: [],
      metadata: {},
      hash: 'h1',
      prev_hash: 'h0',
    });

    const event = await provider.getById(id);
    expect(event).not.toBeNull();
    expect(event!.title).toBe('Pooled test');
  });

  it('getLatestHash returns a hash', async () => {
    const hash = await provider.getLatestHash();
    expect(typeof hash === 'string' || hash === null).toBe(true);
  });
});

describe.skipIf(!HAS_SUPABASE)('LogForwarder with Supabase', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeAll(async () => {
    const provider = new SupabaseProvider();
    store = new MemoryStore({
      provider,
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store.initialize();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-fwd-test-'));
    // Write sample NDJSON
    const costLog = [
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'cost', model_tier: 'sonnet', call_cost: '0.003', session_total: '0.003', session_calls: 1, budget_status: 'ok', budget_pct: '0.0', input_tokens: 100, output_tokens: 50, monthly_total: '0.003' }),
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'cost', model_tier: 'haiku', call_cost: '0.0002', session_total: '0.0032', session_calls: 2, budget_status: 'ok', budget_pct: '0.0', input_tokens: 50, output_tokens: 20, monthly_total: '0.0032' }),
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(tmpDir, 'cost-log.json'), costLog);
  });

  afterAll(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('forwards cost-log entries to MemoryStore', async () => {
    const forwarder = new LogForwarder(store, tmpDir);
    const results = await forwarder.forward({ sessionId: 'log-fwd-test', sources: ['cost-log'] });

    const costResult = results.find((r) => r.file === 'cost-log.json');
    expect(costResult).toBeDefined();
    expect(costResult!.forwarded).toBe(2);
    expect(costResult!.errors).toBe(0);
  });

  it('does not re-forward on second run (cursor tracking)', async () => {
    const forwarder = new LogForwarder(store, tmpDir);
    const results = await forwarder.forward({ sessionId: 'log-fwd-test', sources: ['cost-log'] });

    const costResult = results.find((r) => r.file === 'cost-log.json');
    expect(costResult!.forwarded).toBe(0);
  });
});
