/**
 * Tests for mcp/tools/recall-context.ts.
 *
 * Drives the tool against a REAL in-memory MemoryStore and the REAL
 * ContextRecaller — only the shared-store getter is stubbed, to inject an
 * in-memory SQLite DB instead of the default on-disk singleton. This exercises
 * the genuine recall + query + formatting path (previously fully mocked).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryStore } from '../../../src/memory/store';

// Shared holder so the (hoisted) vi.mock factory and the test body reference the
// same store instance. getSharedStore returns whatever the current test set up.
const shared = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('../../../src/mcp/shared-store', () => ({
  getSharedStore: vi.fn(async () => shared.store),
}));

import { name, description, inputSchema, handler } from '../../../src/mcp/tools/recall-context';

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

describe('recall-context MCP tool', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = createStore();
    await store.initialize();
    shared.store = store;
  });

  afterEach(async () => {
    await store.close();
    shared.store = null;
  });

  it('has correct name and description', () => {
    expect(name).toBe('agent_sentry_recall_context');
    expect(description).toBeTruthy();
    expect(description).toContain('memory');
  });

  it('has correct input schema', () => {
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.required).toContain('query');
    expect(inputSchema.properties.query).toBeDefined();
    expect(inputSchema.properties.max_results).toBeDefined();
    expect(inputSchema.properties.lookback_days).toBeDefined();
  });

  it('rejects missing query', async () => {
    const result = await handler({});
    expect(result.content[0].text).toContain('Error');
  });

  it('rejects non-string query', async () => {
    const result = await handler({ query: 123 });
    expect(result.content[0].text).toContain('Error');
  });

  it('reports no context against an empty store (real recall)', async () => {
    const result = await handler({ query: 'authentication patterns' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('No relevant prior context');
  });

  it('surfaces a seeded session through the real recall path', async () => {
    await store.capture({
      timestamp: new Date().toISOString(),
      session_id: 'auth-session',
      agent_id: 'test',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'authentication middleware change',
      detail: 'Updated authentication middleware to use JWT refresh tokens',
      affected_files: ['src/auth/middleware.ts'],
      tags: ['authentication'],
      metadata: {},
    });

    const result = await handler({ query: 'authentication middleware' });
    const text = result.content[0].text;

    // With noop embeddings recall falls back to text matching, which matches this
    // seed. The formatted output must name the real session the real
    // ContextRecaller pulled from the real store.
    expect(text).toContain('relevant session');
    expect(text).toContain('auth-session');
  });
});
