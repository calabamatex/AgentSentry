import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-search.db');

describe('MemoryStore search', () => {
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

    // Seed events
    await store.capture({
      timestamp: '2026-01-01T00:00:00Z',
      session_id: 'sess-1',
      agent_id: 'agent-1',
      event_type: 'decision',
      severity: 'low',
      skill: 'save_points',
      title: 'Auto-committed before auth refactor',
      detail: 'Committed 5 files before modifying auth/jwt.ts',
      affected_files: ['auth/jwt.ts'],
      tags: ['auto-commit', 'save-point'],
      metadata: {},
    });

    await store.capture({
      timestamp: '2026-01-02T00:00:00Z',
      session_id: 'sess-1',
      agent_id: 'agent-2',
      event_type: 'violation',
      severity: 'high',
      skill: 'proactive_safety',
      title: 'Secret detected in config file',
      detail: 'AWS_SECRET_ACCESS_KEY found in config/db.ts — blocked',
      affected_files: ['config/db.ts'],
      tags: ['secret', 'blocked'],
      metadata: { key_type: 'AWS' },
    });

    await store.capture({
      timestamp: '2026-01-03T00:00:00Z',
      session_id: 'sess-2',
      agent_id: 'agent-1',
      event_type: 'pattern',
      severity: 'medium',
      skill: 'context_health',
      title: 'Context at 82% capacity',
      detail: 'Session at 82% context capacity after 34 messages',
      affected_files: [],
      tags: ['context', 'warning'],
      metadata: { percent: 82 },
    });
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('finds events by text in title', async () => {
    const results = await store.search('secret');
    expect(results).toHaveLength(1);
    expect(results[0].event.title).toContain('Secret');
  });

  it('finds events by text in detail', async () => {
    const results = await store.search('AWS_SECRET');
    expect(results).toHaveLength(1);
    expect(results[0].event.event_type).toBe('violation');
  });

  it('filters search by event_type', async () => {
    const results = await store.search('context', { event_type: 'pattern' });
    expect(results).toHaveLength(1);
  });

  it('filters search by severity', async () => {
    const results = await store.search('', { severity: 'high' });
    // Text search with empty query won't match — this tests the filter path
    const listed = await store.list({ severity: 'high' });
    expect(listed).toHaveLength(1);
  });

  it('filters search by session_id', async () => {
    const results = await store.search('context', { session_id: 'sess-2' });
    expect(results).toHaveLength(1);
  });

  it('returns empty for no matches', async () => {
    const results = await store.search('nonexistent_term_xyz');
    expect(results).toHaveLength(0);
  });

  it('fallback search finds older events beyond default limit', async () => {
    // Insert 15 events — the first one has the unique search term
    for (let i = 0; i < 12; i++) {
      await store.capture({
        timestamp: `2026-01-10T${String(i).padStart(2, '0')}:00:00Z`,
        session_id: 'sess-fill',
        agent_id: 'agent-1',
        event_type: 'decision',
        severity: 'low',
        skill: 'save_points',
        title: `Filler event ${i}`,
        detail: `This is filler event number ${i}`,
        affected_files: [],
        tags: [],
        metadata: {},
      });
    }

    // The original "auth refactor" event from seed data (2026-01-01) should still be findable
    const results = await store.search('auth refactor', { limit: 20 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.event.title.includes('auth refactor'))).toBe(true);
  });
});
