/**
 * capture-event.test.ts — Tests for agent_sentry_capture_event tool.
 *
 * Drives the tool against a REAL in-memory MemoryStore — only the shared-store
 * getter is stubbed (to inject an in-memory SQLite DB). Captures are verified by
 * reading the event back out of the store, so the real capture/persist/hash-chain
 * path is exercised (previously the store was fully mocked).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryStore } from '../../../src/memory/store';

const shared = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('../../../src/mcp/shared-store', () => ({
  getSharedStore: vi.fn(async () => shared.store),
}));

import { handler } from '../../../src/mcp/tools/capture-event';

function createStore(): MemoryStore {
  return new MemoryStore({
    config: {
      enabled: true,
      provider: 'sqlite',
      embedding_provider: 'noop',
      database_path: ':memory:',
      max_events: 100000,
      auto_prune_days: 365,
    },
  });
}

describe('agent_sentry_capture_event', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = createStore();
    await store.initialize();
    shared.store = store;
  });

  afterEach(async () => {
    try {
      await store.close();
    } catch {
      /* may already be closed by a test */
    }
    shared.store = null;
  });

  it('captures a valid event and persists it with a real hash', async () => {
    const result = await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test event',
      detail: 'Test detail',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.event_type).toBe('decision');
    expect(parsed.severity).toBe('low');
    expect(parsed.id).toBeTruthy();
    // Real SHA-256 hash chain (not a canned mock value).
    expect(parsed.hash).toMatch(/^[a-f0-9]{64}$/);

    // The event must actually be in the store.
    const persisted = await store.list({ limit: 10 });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(parsed.id);
    expect(persisted[0].title).toBe('Test event');
    expect(persisted[0].hash).toBe(parsed.hash);
  });

  it('persists affected_files and tags', async () => {
    const result = await handler({
      event_type: 'violation',
      severity: 'high',
      skill: 'proactive_safety',
      title: 'Rule violation',
      detail: 'File was modified',
      affected_files: ['src/test.ts'],
      tags: ['safety', 'violation'],
    });
    const parsed = JSON.parse(result.content[0].text);

    const persisted = await store.list({ limit: 10 });
    const event = persisted.find((e) => e.id === parsed.id);
    expect(event).toBeDefined();
    expect(event!.affected_files).toEqual(['src/test.ts']);
    expect(event!.tags).toEqual(['safety', 'violation']);
  });

  it('defaults affected_files and tags to empty arrays', async () => {
    const result = await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });
    const parsed = JSON.parse(result.content[0].text);

    const persisted = await store.list({ limit: 10 });
    const event = persisted.find((e) => e.id === parsed.id);
    expect(event).toBeDefined();
    expect(event!.affected_files).toEqual([]);
    expect(event!.tags).toEqual([]);
  });

  it('rejects invalid event_type', async () => {
    const result = await handler({
      event_type: 'invalid_type',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
  });

  it('rejects invalid severity', async () => {
    const result = await handler({
      event_type: 'decision',
      severity: 'super_high',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
  });

  it('rejects missing required fields', async () => {
    const result = await handler({ event_type: 'decision' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
  });

  it('handles store errors gracefully', async () => {
    // Error paths legitimately need a failing dependency; swap in a stub whose
    // capture rejects (the happy/persistence paths above use the real store).
    shared.store = { capture: vi.fn().mockRejectedValue(new Error('DB connection failed')) };

    const result = await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('DB connection failed');
  });
});
