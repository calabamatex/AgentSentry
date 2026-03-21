/**
 * Tests for memory/handoff.ts — HandoffGenerator.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store';
import { HandoffGenerator } from '../../src/memory/handoff';

function createTestStore(): MemoryStore {
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

describe('HandoffGenerator', () => {
  let store: MemoryStore;
  let generator: HandoffGenerator;

  beforeEach(async () => {
    store = createTestStore();
    await store.initialize();
    generator = new HandoffGenerator(store);
  });

  afterEach(async () => {
    await store.close();
  });

  it('generates handoff for empty session', async () => {
    const handoff = await generator.generate('empty-session');
    expect(handoff.session_id).toBe('empty-session');
    expect(handoff.formatted).toContain('empty-session');
    expect(handoff.files_changed).toEqual([]);
  });

  it('generates handoff with session events', async () => {
    await store.capture({
      timestamp: new Date(Date.now() - 60000).toISOString(),
      session_id: 'work-session',
      agent_id: 'test',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'implemented-feature',
      detail: 'Added new authentication module',
      affected_files: ['src/auth.ts', 'src/middleware.ts'],
      tags: [],
      metadata: {},
    });

    await store.capture({
      timestamp: new Date().toISOString(),
      session_id: 'work-session',
      agent_id: 'test',
      event_type: 'incident',
      severity: 'high',
      skill: 'system',
      title: 'test-failure',
      detail: 'Unit tests failed after auth change',
      affected_files: ['tests/auth.test.ts'],
      tags: [],
      metadata: {},
    });

    const handoff = await generator.generate('work-session');

    expect(handoff.files_changed.length).toBe(3);
    expect(handoff.errors_encountered.length).toBe(1);
    expect(handoff.errors_encountered[0].title).toBe('test-failure');
    expect(handoff.formatted).toContain('work-session');
    expect(handoff.formatted).toContain('2 events');
  });

  it('includes remaining work in formatted output', async () => {
    const handoff = await generator.generate('session-1', {
      remainingWork: ['Fix auth tests', 'Deploy to staging'],
    });

    expect(handoff.remaining_work).toEqual(['Fix auth tests', 'Deploy to staging']);
    expect(handoff.formatted).toContain('Fix auth tests');
    expect(handoff.formatted).toContain('Deploy to staging');
  });

  it('generateAndStore persists the handoff event', async () => {
    await store.capture({
      timestamp: new Date().toISOString(),
      session_id: 'store-session',
      agent_id: 'test',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'work',
      detail: 'Did some work',
      affected_files: [],
      tags: [],
      metadata: {},
    });

    const handoff = await generator.generateAndStore('store-session');
    expect(handoff.session_id).toBe('store-session');

    const events = await store.list({ tag: 'handoff', limit: 10 });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const handoffEvent = events.find(e => e.title === 'handoff:store-session');
    expect(handoffEvent).toBeDefined();
  });
});
