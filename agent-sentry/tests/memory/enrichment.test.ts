import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpsEvent, OpsEventInput } from '../../src/memory/schema';
import { MemoryStore } from '../../src/memory/store';
import {
  LocalPatternMatcher,
  EventEnricher,
  EnrichmentProvider,
  EnrichmentResult,
} from '../../src/memory/enrichment';

// Mock child_process for git branch detection
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('feature/test-branch\n'),
}));

import { execSync } from 'child_process';

const mockedExecSync = vi.mocked(execSync);

/** Helper to create a fully-formed OpsEvent for testing. */
function makeOpsEvent(overrides: Partial<OpsEvent> = {}): OpsEvent {
  return {
    id: 'evt-1',
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'A test event',
    affected_files: [],
    tags: ['test'],
    metadata: {},
    hash: 'a'.repeat(64),
    prev_hash: '0'.repeat(64),
    ...overrides,
  };
}

function makeOpsEventInput(overrides: Partial<OpsEventInput> = {}): OpsEventInput {
  return {
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'A test event',
    affected_files: [],
    tags: ['test'],
    metadata: {},
    ...overrides,
  };
}

describe('LocalPatternMatcher', () => {
  let matcher: LocalPatternMatcher;

  beforeEach(() => {
    matcher = new LocalPatternMatcher();
    mockedExecSync.mockReturnValue('feature/test-branch\n');
  });

  describe('cross-tagging', () => {
    it('tags auth files with authentication', async () => {
      const event = makeOpsEvent({ affected_files: ['src/auth/login.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('authentication');
    });

    it('tags login files with authentication', async () => {
      const event = makeOpsEvent({ affected_files: ['src/login/handler.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('authentication');
    });

    it('tags session files with authentication', async () => {
      const event = makeOpsEvent({ affected_files: ['lib/session/store.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('authentication');
    });

    it('tags jwt files with authentication', async () => {
      const event = makeOpsEvent({ affected_files: ['src/jwt/verify.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('authentication');
    });

    it('tags db files with database', async () => {
      const event = makeOpsEvent({ affected_files: ['src/db/connection.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('database');
    });

    it('tags migration files with database', async () => {
      const event = makeOpsEvent({ affected_files: ['src/migration/001.sql'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('database');
    });

    it('tags schema files with database', async () => {
      const event = makeOpsEvent({ affected_files: ['src/schema/users.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('database');
    });

    it('tags api files with api', async () => {
      const event = makeOpsEvent({ affected_files: ['src/api/users.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('api');
    });

    it('tags routes files with api', async () => {
      const event = makeOpsEvent({ affected_files: ['src/routes/index.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('api');
    });

    it('tags endpoint files with api', async () => {
      const event = makeOpsEvent({ affected_files: ['src/endpoint/health.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('api');
    });

    it('tags test files with testing', async () => {
      const event = makeOpsEvent({ affected_files: ['src/test/user.test.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('testing');
    });

    it('tags spec files with testing', async () => {
      const event = makeOpsEvent({ affected_files: ['src/spec/helper.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('testing');
    });

    it('tags __test__ files with testing', async () => {
      const event = makeOpsEvent({ affected_files: ['src/__test__/unit.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('testing');
    });

    it('tags config files with configuration', async () => {
      const event = makeOpsEvent({ affected_files: ['src/config/app.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('configuration');
    });

    it('tags .env files with configuration', async () => {
      const event = makeOpsEvent({ affected_files: ['.env'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('configuration');
    });

    it('tags settings files with configuration', async () => {
      const event = makeOpsEvent({ affected_files: ['src/settings/defaults.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('configuration');
    });

    it('tags deploy files with infrastructure', async () => {
      const event = makeOpsEvent({ affected_files: ['deploy/production.yml'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('infrastructure');
    });

    it('tags ci files with infrastructure', async () => {
      const event = makeOpsEvent({ affected_files: ['ci/pipeline.yml'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('infrastructure');
    });

    it('tags docker files with infrastructure', async () => {
      const event = makeOpsEvent({ affected_files: ['docker/Dockerfile'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('infrastructure');
    });

    it('produces multiple tags for files spanning domains', async () => {
      const event = makeOpsEvent({
        affected_files: ['src/auth/login.ts', 'src/db/users.ts', 'src/api/auth.ts'],
      });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toContain('authentication');
      expect(result.cross_tags).toContain('database');
      expect(result.cross_tags).toContain('api');
    });

    it('returns sorted unique tags', async () => {
      const event = makeOpsEvent({
        affected_files: ['src/auth/a.ts', 'src/login/b.ts'],
      });
      const result = await matcher.enrich(event, []);
      // Both map to 'authentication', should appear only once
      expect(result.cross_tags.filter((t) => t === 'authentication')).toHaveLength(1);
      expect(result.cross_tags).toEqual([...result.cross_tags].sort());
    });

    it('returns empty tags for unrecognized paths', async () => {
      const event = makeOpsEvent({ affected_files: ['src/utils/helper.ts'] });
      const result = await matcher.enrich(event, []);
      expect(result.cross_tags).toEqual([]);
    });
  });

  describe('root cause detection', () => {
    it('detects root cause when 3+ events share files', async () => {
      const event = makeOpsEvent({
        id: 'evt-current',
        affected_files: ['src/foo.ts', 'src/bar.ts'],
      });
      const recentEvents = [
        makeOpsEvent({ id: 'evt-2', affected_files: ['src/foo.ts'] }),
        makeOpsEvent({ id: 'evt-3', affected_files: ['src/foo.ts', 'src/baz.ts'] }),
        makeOpsEvent({ id: 'evt-4', affected_files: ['src/bar.ts', 'src/foo.ts'] }),
      ];

      const result = await matcher.enrich(event, recentEvents);
      expect(result.root_cause_hint).toBeDefined();
      expect(result.root_cause_hint).toContain('Recurring pattern on');
      expect(result.root_cause_hint).toContain('consider a dedicated rule');
    });

    it('returns no root cause hint with fewer than 3 overlapping events', async () => {
      const event = makeOpsEvent({
        id: 'evt-current',
        affected_files: ['src/foo.ts'],
      });
      const recentEvents = [
        makeOpsEvent({ id: 'evt-2', affected_files: ['src/foo.ts'] }),
        makeOpsEvent({ id: 'evt-3', affected_files: ['src/foo.ts'] }),
      ];

      const result = await matcher.enrich(event, recentEvents);
      expect(result.root_cause_hint).toBeUndefined();
    });

    it('returns no root cause hint when event has no affected files', async () => {
      const event = makeOpsEvent({ id: 'evt-current', affected_files: [] });
      const recentEvents = [
        makeOpsEvent({ id: 'evt-2', affected_files: ['src/foo.ts'] }),
        makeOpsEvent({ id: 'evt-3', affected_files: ['src/foo.ts'] }),
        makeOpsEvent({ id: 'evt-4', affected_files: ['src/foo.ts'] }),
      ];

      const result = await matcher.enrich(event, recentEvents);
      expect(result.root_cause_hint).toBeUndefined();
    });

    it('does not count the event itself as overlapping', async () => {
      const event = makeOpsEvent({
        id: 'evt-1',
        affected_files: ['src/foo.ts'],
      });
      // Include the event itself in recentEvents; should be skipped
      const recentEvents = [
        event,
        makeOpsEvent({ id: 'evt-2', affected_files: ['src/foo.ts'] }),
        makeOpsEvent({ id: 'evt-3', affected_files: ['src/foo.ts'] }),
      ];

      const result = await matcher.enrich(event, recentEvents);
      // Only 2 overlapping (evt-2, evt-3), not 3
      expect(result.root_cause_hint).toBeUndefined();
    });
  });

  describe('related events', () => {
    it('finds related events by overlapping files', async () => {
      const event = makeOpsEvent({
        id: 'evt-current',
        affected_files: ['src/foo.ts'],
        tags: [],
      });
      const recentEvents = [
        makeOpsEvent({ id: 'evt-2', affected_files: ['src/foo.ts'], tags: [] }),
        makeOpsEvent({ id: 'evt-3', affected_files: ['src/other.ts'], tags: [] }),
      ];

      const result = await matcher.enrich(event, recentEvents);
      expect(result.related_events).toContain('evt-2');
      expect(result.related_events).not.toContain('evt-3');
    });

    it('finds related events by overlapping tags', async () => {
      const event = makeOpsEvent({
        id: 'evt-current',
        affected_files: [],
        tags: ['auth', 'security'],
      });
      const recentEvents = [
        makeOpsEvent({ id: 'evt-2', affected_files: [], tags: ['auth'] }),
        makeOpsEvent({ id: 'evt-3', affected_files: [], tags: ['unrelated'] }),
      ];

      const result = await matcher.enrich(event, recentEvents);
      expect(result.related_events).toContain('evt-2');
      expect(result.related_events).not.toContain('evt-3');
    });

    it('returns at most 5 related events', async () => {
      const event = makeOpsEvent({
        id: 'evt-current',
        affected_files: ['src/foo.ts'],
        tags: ['test'],
      });
      const recentEvents = Array.from({ length: 10 }, (_, i) =>
        makeOpsEvent({
          id: `evt-${i + 10}`,
          affected_files: ['src/foo.ts'],
          tags: ['test'],
        }),
      );

      const result = await matcher.enrich(event, recentEvents);
      expect(result.related_events.length).toBeLessThanOrEqual(5);
    });

    it('ranks by overlap score (files weighted higher than tags)', async () => {
      const event = makeOpsEvent({
        id: 'evt-current',
        affected_files: ['src/foo.ts'],
        tags: ['alpha'],
      });
      const recentEvents = [
        makeOpsEvent({ id: 'evt-tag-only', affected_files: [], tags: ['alpha'] }),
        makeOpsEvent({ id: 'evt-file-match', affected_files: ['src/foo.ts'], tags: [] }),
      ];

      const result = await matcher.enrich(event, recentEvents);
      // File match should rank higher
      expect(result.related_events[0]).toBe('evt-file-match');
    });
  });

  describe('severity context', () => {
    it('returns mitigation message for high severity on feature branch', async () => {
      mockedExecSync.mockReturnValue('feature/test\n');
      const event = makeOpsEvent({ severity: 'high' });
      const result = await matcher.enrich(event, []);
      expect(result.severity_context).toBe('High severity mitigated by feature branch isolation');
    });

    it('returns critical mitigation on feature branch', async () => {
      mockedExecSync.mockReturnValue('feature/test\n');
      const event = makeOpsEvent({ severity: 'critical' });
      const result = await matcher.enrich(event, []);
      expect(result.severity_context).toBe('Critical severity mitigated by feature branch isolation');
    });

    it('returns immediate action message for critical on main', async () => {
      mockedExecSync.mockReturnValue('main\n');
      const event = makeOpsEvent({ severity: 'critical' });
      const result = await matcher.enrich(event, []);
      expect(result.severity_context).toBe('Critical on main branch — immediate action required');
    });

    it('returns immediate action message for critical on master', async () => {
      mockedExecSync.mockReturnValue('master\n');
      const event = makeOpsEvent({ severity: 'critical' });
      const result = await matcher.enrich(event, []);
      expect(result.severity_context).toBe('Critical on main branch — immediate action required');
    });

    it('returns undefined for low severity', async () => {
      const event = makeOpsEvent({ severity: 'low' });
      const result = await matcher.enrich(event, []);
      expect(result.severity_context).toBeUndefined();
    });

    it('returns undefined for medium severity', async () => {
      const event = makeOpsEvent({ severity: 'medium' });
      const result = await matcher.enrich(event, []);
      expect(result.severity_context).toBeUndefined();
    });

    it('handles git branch detection failure gracefully', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('git not found');
      });
      const event = makeOpsEvent({ severity: 'high' });
      const result = await matcher.enrich(event, []);
      expect(result.severity_context).toBeUndefined();
    });
  });
});

describe('EventEnricher', () => {
  let mockStore: {
    initialize: ReturnType<typeof vi.fn>;
    capture: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
    verifyChain: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockStore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      capture: vi.fn().mockImplementation(async (input: OpsEventInput) => ({
        ...input,
        id: 'new-evt-1',
        hash: 'h'.repeat(64),
        prev_hash: '0'.repeat(64),
      })),
      list: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
      stats: vi.fn().mockResolvedValue({}),
      verifyChain: vi.fn().mockResolvedValue({ valid: true, total_checked: 0 }),
    };
  });

  it('enriches an event with default LocalPatternMatcher', async () => {
    const enricher = new EventEnricher(mockStore as unknown as MemoryStore);
    const event = makeOpsEvent({ affected_files: ['src/auth/login.ts'] });

    const result = await enricher.enrichEvent(event);
    expect(result.cross_tags).toContain('authentication');
    expect(mockStore.list).toHaveBeenCalled();
  });

  it('merges results from multiple providers', async () => {
    const providerA: EnrichmentProvider = {
      enrich: vi.fn().mockResolvedValue({
        cross_tags: ['tag-a'],
        root_cause_hint: 'hint from A',
        related_events: ['evt-a1'],
        severity_context: 'context from A',
      } satisfies EnrichmentResult),
    };
    const providerB: EnrichmentProvider = {
      enrich: vi.fn().mockResolvedValue({
        cross_tags: ['tag-b', 'tag-a'],
        root_cause_hint: 'hint from B',
        related_events: ['evt-b1'],
        severity_context: undefined,
      } satisfies EnrichmentResult),
    };

    const enricher = new EventEnricher(
      mockStore as unknown as MemoryStore,
      [providerA, providerB],
    );
    const event = makeOpsEvent();

    const result = await enricher.enrichEvent(event);
    // Tags are merged and deduplicated
    expect(result.cross_tags).toContain('tag-a');
    expect(result.cross_tags).toContain('tag-b');
    // First root_cause_hint wins
    expect(result.root_cause_hint).toBe('hint from A');
    // Related events are unioned
    expect(result.related_events).toContain('evt-a1');
    expect(result.related_events).toContain('evt-b1');
    // First severity_context wins
    expect(result.severity_context).toBe('context from A');
  });

  it('fetches recent events from last 7 days', async () => {
    const enricher = new EventEnricher(mockStore as unknown as MemoryStore);
    const event = makeOpsEvent();

    await enricher.enrichEvent(event);

    expect(mockStore.list).toHaveBeenCalledWith(
      expect.objectContaining({
        since: expect.any(String),
        limit: 100,
      }),
    );

    const callArgs = mockStore.list.mock.calls[0][0];
    const sinceDate = new Date(callArgs.since);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    // Within 5 seconds tolerance
    expect(Math.abs(sinceDate.getTime() - sevenDaysAgo.getTime())).toBeLessThan(5000);
  });

  describe('captureAndEnrich', () => {
    it('initializes store, captures event, and enriches', async () => {
      const enricher = new EventEnricher(mockStore as unknown as MemoryStore);
      const input = makeOpsEventInput({
        affected_files: ['src/api/users.ts'],
      });

      const { event, enrichment } = await enricher.captureAndEnrich(input);

      expect(mockStore.initialize).toHaveBeenCalled();
      expect(mockStore.capture).toHaveBeenCalledWith(input);
      expect(event.id).toBe('new-evt-1');
      expect(enrichment.cross_tags).toContain('api');
    });

    it('returns enrichment even when no patterns match', async () => {
      const enricher = new EventEnricher(mockStore as unknown as MemoryStore);
      const input = makeOpsEventInput({
        affected_files: ['src/utils/helper.ts'],
      });

      const { enrichment } = await enricher.captureAndEnrich(input);

      expect(enrichment.cross_tags).toEqual([]);
      expect(enrichment.related_events).toEqual([]);
    });
  });
});
