import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-integration.db');

describe('Integration: full capture → search → verify', () => {
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

  it('full lifecycle: capture → list → search → stats → verifyChain', async () => {
    // Capture events
    const e1 = await store.capture({
      timestamp: '2026-03-20T10:00:00Z',
      session_id: 'integration-sess',
      agent_id: 'coder-1',
      event_type: 'decision',
      severity: 'low',
      skill: 'save_points',
      title: 'Auto-committed before refactor',
      detail: 'Committed 3 files before auth module refactoring',
      affected_files: ['src/auth.ts', 'src/db.ts', 'src/utils.ts'],
      tags: ['auto-commit'],
      metadata: { files_count: 3 },
    });

    const e2 = await store.capture({
      timestamp: '2026-03-20T10:05:00Z',
      session_id: 'integration-sess',
      agent_id: 'coder-1',
      event_type: 'violation',
      severity: 'critical',
      skill: 'proactive_safety',
      title: 'API key blocked in commit',
      detail: 'OPENAI_API_KEY detected in src/config.ts — write blocked',
      affected_files: ['src/config.ts'],
      tags: ['secret', 'blocked', 'critical'],
      metadata: { key_type: 'OPENAI' },
    });

    const e3 = await store.capture({
      timestamp: '2026-03-20T10:10:00Z',
      session_id: 'integration-sess',
      agent_id: 'system',
      event_type: 'handoff',
      severity: 'medium',
      skill: 'context_health',
      title: 'Session handoff at 85% context',
      detail: 'Context capacity reaching limit. Handoff recommended.',
      affected_files: [],
      tags: ['handoff', 'context'],
      metadata: { context_percent: 85 },
    });

    // Verify chain integrity
    expect(e2.prev_hash).toBe(e1.hash);
    expect(e3.prev_hash).toBe(e2.hash);

    // List all events
    const all = await store.list();
    expect(all).toHaveLength(3);

    // List with filter
    const violations = await store.list({ event_type: 'violation' });
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe('critical');

    // Search
    const searchResults = await store.search('API key');
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].event.id).toBe(e2.id);

    // Stats
    const stats = await store.stats({ session_id: 'integration-sess' });
    expect(stats.total_events).toBe(3);
    expect(stats.by_type.decision).toBe(1);
    expect(stats.by_type.violation).toBe(1);
    expect(stats.by_type.handoff).toBe(1);
    expect(stats.by_severity.critical).toBe(1);

    // Verify chain
    const chain = await store.verifyChain();
    expect(chain.valid).toBe(true);
    expect(chain.total_checked).toBe(3);
  });

  it('recovers hash chain across close/reopen', async () => {
    await store.capture({
      timestamp: '2026-03-20T10:00:00Z',
      session_id: 'persist-test',
      agent_id: 'agent-1',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'First event',
      detail: 'Before close',
      affected_files: [],
      tags: [],
      metadata: {},
    });

    await store.close();

    // Reopen
    const store2 = new MemoryStore({
      provider: new SqliteProvider(TEST_DB),
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store2.initialize();

    const e2 = await store2.capture({
      timestamp: '2026-03-20T10:05:00Z',
      session_id: 'persist-test',
      agent_id: 'agent-1',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Second event after reopen',
      detail: 'After reopen',
      affected_files: [],
      tags: [],
      metadata: {},
    });

    const chain = await store2.verifyChain();
    expect(chain.valid).toBe(true);
    expect(chain.total_checked).toBe(2);

    // The second event should link to the first
    const all = await store2.list();
    expect(all).toHaveLength(2);

    await store2.close();
  });
});
