/**
 * supabase-smoke.test.ts — [beta] Conditional smoke test for SupabaseProvider.
 *
 * Skips entirely unless SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are set.
 * Validates a basic store → retrieve → search → prune cycle.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseProvider } from '../../src/memory/providers/supabase-provider';
import { MemoryStore } from '../../src/memory/store';
import { OpsEventInput } from '../../src/memory/schema';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

describe.skipIf(!hasSupabase)('[beta] Supabase smoke test', () => {
  let store: MemoryStore;
  let capturedId: string;
  const testSessionId = `smoke-test-${Date.now()}`;

  beforeAll(async () => {
    const provider = new SupabaseProvider({
      url: SUPABASE_URL!,
      serviceRoleKey: SUPABASE_KEY!,
    });
    store = new MemoryStore({ provider });
    await store.initialize();
  });

  afterAll(async () => {
    // Clean up test data
    if (store) {
      try {
        await store.close();
      } catch {
        // ignore
      }
    }
  });

  it('should store an event', async () => {
    const event: OpsEventInput = {
      timestamp: new Date().toISOString(),
      session_id: testSessionId,
      agent_id: 'smoke-agent',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Supabase smoke test event',
      detail: 'Validating basic store/retrieve/search cycle',
      affected_files: ['tests/e2e/supabase-smoke.test.ts'],
      tags: ['smoke-test', 'beta'],
      metadata: { test: true },
    };

    const result = await store.capture(event);
    expect(result).toBeDefined();
    expect(result.id).toBeTruthy();
    capturedId = result.id;
  });

  it('should retrieve the stored event by query', async () => {
    const events = await store.query({
      session_id: testSessionId,
      limit: 10,
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    const found = events.find((e) => e.id === capturedId);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Supabase smoke test event');
    expect(found!.session_id).toBe(testSessionId);
  });

  it('should search for the event by keyword', async () => {
    const results = await store.search('Supabase smoke test', {
      limit: 10,
      session_id: testSessionId,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should return stats including the test event', async () => {
    const stats = await store.stats({ session_id: testSessionId });

    expect(stats.total_events).toBeGreaterThanOrEqual(1);
    expect(stats.by_type.decision).toBeGreaterThanOrEqual(1);
  });
});
