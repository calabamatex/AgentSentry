import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpsEvent, OpsEventInput } from '../../src/memory/schema';
import { MemoryStore } from '../../src/memory/store';
import { AuditIndex, AuditSummary } from '../../src/memory/audit-index';

// Mock uuid to produce predictable IDs
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('audit-uuid-1'),
}));

/** Helper to create a fully-formed OpsEvent for testing. */
function makeOpsEvent(overrides: Partial<OpsEvent> = {}): OpsEvent {
  return {
    id: 'evt-1',
    timestamp: '2026-03-15T10:00:00.000Z',
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

function makeAuditEvent(overrides: Partial<OpsEvent> = {}): OpsEvent {
  return makeOpsEvent({
    event_type: 'audit_finding',
    title: 'Audit: Test event',
    detail: 'Agent agent-1 recorded decision (low) for system: Test event',
    tags: ['test', 'audit_index'],
    metadata: {
      audit_record_id: 'audit-uuid-1',
      source_event_id: 'evt-1',
      source_event_type: 'decision',
    },
    ...overrides,
  });
}

describe('AuditIndex', () => {
  let mockStore: {
    initialize: ReturnType<typeof vi.fn>;
    capture: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    stats: ReturnType<typeof vi.fn>;
    verifyChain: ReturnType<typeof vi.fn>;
  };
  let auditIndex: AuditIndex;

  beforeEach(() => {
    mockStore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      capture: vi.fn().mockImplementation(async (input: OpsEventInput) => ({
        ...input,
        id: 'audit-evt-1',
        hash: 'h'.repeat(64),
        prev_hash: '0'.repeat(64),
      })),
      list: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
      stats: vi.fn().mockResolvedValue({}),
      verifyChain: vi.fn().mockResolvedValue({ valid: true, total_checked: 0 }),
    };
    auditIndex = new AuditIndex(mockStore as unknown as MemoryStore);
  });

  describe('generateSummary', () => {
    it('generates summary in the expected format', () => {
      const event = makeOpsEvent({
        agent_id: 'agent-42',
        event_type: 'violation',
        severity: 'high',
        skill: 'proactive_safety',
        title: 'Unsafe operation detected',
      });

      const summary = auditIndex.generateSummary(event);
      expect(summary).toBe(
        'Agent agent-42 recorded violation (high) for proactive_safety: Unsafe operation detected',
      );
    });

    it('includes affected files when present', () => {
      const event = makeOpsEvent({
        affected_files: ['src/auth/login.ts', 'src/db/users.ts'],
      });

      const summary = auditIndex.generateSummary(event);
      expect(summary).toContain('[files: src/auth/login.ts, src/db/users.ts]');
    });

    it('truncates affected files list to 5 and shows count', () => {
      const files = Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`);
      const event = makeOpsEvent({ affected_files: files });

      const summary = auditIndex.generateSummary(event);
      expect(summary).toContain('and 3 more');
      // Should include the first 5 files
      expect(summary).toContain('src/file0.ts');
      expect(summary).toContain('src/file4.ts');
      // Should NOT include the 6th file directly
      expect(summary).not.toContain('src/file5.ts,');
    });

    it('does not append file info when no affected files', () => {
      const event = makeOpsEvent({ affected_files: [] });
      const summary = auditIndex.generateSummary(event);
      expect(summary).not.toContain('[files:');
    });
  });

  describe('indexEvent', () => {
    it('initializes the store', async () => {
      const event = makeOpsEvent();
      await auditIndex.indexEvent(event);
      expect(mockStore.initialize).toHaveBeenCalled();
    });

    it('captures an audit_finding event', async () => {
      const event = makeOpsEvent({
        id: 'evt-source',
        session_id: 'sess-42',
        agent_id: 'agent-42',
        severity: 'high',
        skill: 'proactive_safety',
        title: 'Security issue',
        affected_files: ['src/auth/login.ts'],
        tags: ['security'],
      });

      await auditIndex.indexEvent(event);

      expect(mockStore.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'audit_finding',
          session_id: 'sess-42',
          agent_id: 'agent-42',
          severity: 'high',
          skill: 'proactive_safety',
          affected_files: ['src/auth/login.ts'],
          tags: ['security', 'audit_index'],
          metadata: expect.objectContaining({
            audit_record_id: 'audit-uuid-1',
            source_event_id: 'evt-source',
            source_event_type: 'decision',
          }),
        }),
      );
    });

    it('includes the summary in the detail field', async () => {
      const event = makeOpsEvent({ title: 'My specific event' });
      await auditIndex.indexEvent(event);

      const captureArg = mockStore.capture.mock.calls[0][0];
      expect(captureArg.detail).toContain('My specific event');
      expect(captureArg.detail).toContain('Agent agent-1 recorded');
    });

    it('truncates the audit title to 120 chars', async () => {
      const longTitle = 'A'.repeat(120);
      const event = makeOpsEvent({ title: longTitle });
      await auditIndex.indexEvent(event);

      const captureArg = mockStore.capture.mock.calls[0][0];
      expect(captureArg.title.length).toBeLessThanOrEqual(120);
    });

    it('returns a well-formed AuditSummary', async () => {
      const event = makeOpsEvent({ id: 'evt-original' });
      const result: AuditSummary = await auditIndex.indexEvent(event);

      expect(result.audit_record_id).toBe('audit-uuid-1');
      expect(result.event_id).toBe('evt-original');
      expect(result.summary).toContain('Agent agent-1');
      expect(result.timestamp).toBe(event.timestamp);
    });
  });

  describe('search', () => {
    it('initializes the store', async () => {
      await auditIndex.search('test query');
      expect(mockStore.initialize).toHaveBeenCalled();
    });

    it('delegates to store.search with audit_finding filter', async () => {
      await auditIndex.search('authentication issue', { limit: 5 });

      expect(mockStore.search).toHaveBeenCalledWith('authentication issue', {
        limit: 5,
        event_type: 'audit_finding',
        since: undefined,
      });
    });

    it('maps search results to AuditSearchResults', async () => {
      const auditEvent = makeAuditEvent();
      mockStore.search.mockResolvedValue([
        { event: auditEvent, score: 0.95 },
      ]);

      const results = await auditIndex.search('test');

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
      expect(results[0].summary.event_id).toBe('evt-1');
      expect(results[0].event).toBe(auditEvent);
    });

    it('filters by source event_type when specified', async () => {
      const violationAudit = makeAuditEvent({
        id: 'aud-1',
        metadata: {
          audit_record_id: 'ar-1',
          source_event_id: 'evt-v1',
          source_event_type: 'violation',
        },
      });
      const decisionAudit = makeAuditEvent({
        id: 'aud-2',
        metadata: {
          audit_record_id: 'ar-2',
          source_event_id: 'evt-d1',
          source_event_type: 'decision',
        },
      });

      mockStore.search.mockResolvedValue([
        { event: violationAudit, score: 0.9 },
        { event: decisionAudit, score: 0.8 },
      ]);

      const results = await auditIndex.search('test', { event_type: 'violation' });

      expect(results).toHaveLength(1);
      expect(results[0].summary.event_id).toBe('evt-v1');
    });

    it('defaults to limit of 20', async () => {
      await auditIndex.search('query');

      expect(mockStore.search).toHaveBeenCalledWith('query', {
        limit: 20,
        event_type: 'audit_finding',
        since: undefined,
      });
    });

    it('passes since option to store search', async () => {
      await auditIndex.search('query', { since: '2026-03-01T00:00:00Z' });

      expect(mockStore.search).toHaveBeenCalledWith('query', {
        limit: 20,
        event_type: 'audit_finding',
        since: '2026-03-01T00:00:00Z',
      });
    });
  });

  describe('getFileAuditTrail', () => {
    it('initializes the store', async () => {
      await auditIndex.getFileAuditTrail('src/foo.ts');
      expect(mockStore.initialize).toHaveBeenCalled();
    });

    it('lists audit_finding events and filters by file path', async () => {
      const matchingEvent = makeAuditEvent({
        id: 'aud-match',
        affected_files: ['src/auth/login.ts'],
      });
      const nonMatchingEvent = makeAuditEvent({
        id: 'aud-no-match',
        affected_files: ['src/db/users.ts'],
      });

      mockStore.list.mockResolvedValue([matchingEvent, nonMatchingEvent]);

      const results = await auditIndex.getFileAuditTrail('src/auth/login.ts');

      expect(results).toHaveLength(1);
      expect(results[0].event.id).toBe('aud-match');
      expect(results[0].score).toBe(1.0);
    });

    it('matches partial file paths', async () => {
      const event = makeAuditEvent({
        affected_files: ['src/auth/login.ts'],
      });
      mockStore.list.mockResolvedValue([event]);

      const results = await auditIndex.getFileAuditTrail('auth/login');
      expect(results).toHaveLength(1);
    });

    it('passes limit and since options to store', async () => {
      await auditIndex.getFileAuditTrail('src/foo.ts', {
        limit: 10,
        since: '2026-03-01T00:00:00Z',
      });

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'audit_finding',
          tag: 'audit_index',
          limit: 10,
          since: '2026-03-01T00:00:00Z',
        }),
      );
    });

    it('returns empty array when no files match', async () => {
      mockStore.list.mockResolvedValue([
        makeAuditEvent({ affected_files: ['src/other.ts'] }),
      ]);

      const results = await auditIndex.getFileAuditTrail('src/nonexistent.ts');
      expect(results).toEqual([]);
    });
  });

  describe('getSessionTimeline', () => {
    it('initializes the store', async () => {
      await auditIndex.getSessionTimeline('sess-1');
      expect(mockStore.initialize).toHaveBeenCalled();
    });

    it('lists audit_finding events for the session', async () => {
      await auditIndex.getSessionTimeline('sess-42');

      expect(mockStore.list).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: 'sess-42',
          event_type: 'audit_finding',
          tag: 'audit_index',
          limit: 200,
        }),
      );
    });

    it('returns events sorted by timestamp ascending', async () => {
      const events = [
        makeAuditEvent({ id: 'aud-3', timestamp: '2026-03-15T12:00:00Z' }),
        makeAuditEvent({ id: 'aud-1', timestamp: '2026-03-15T08:00:00Z' }),
        makeAuditEvent({ id: 'aud-2', timestamp: '2026-03-15T10:00:00Z' }),
      ];
      mockStore.list.mockResolvedValue(events);

      const results = await auditIndex.getSessionTimeline('sess-1');

      expect(results[0].event.id).toBe('aud-1');
      expect(results[1].event.id).toBe('aud-2');
      expect(results[2].event.id).toBe('aud-3');
    });

    it('returns empty array for session with no events', async () => {
      mockStore.list.mockResolvedValue([]);
      const results = await auditIndex.getSessionTimeline('sess-empty');
      expect(results).toEqual([]);
    });

    it('extracts audit summary from each event', async () => {
      const event = makeAuditEvent({
        metadata: {
          audit_record_id: 'ar-123',
          source_event_id: 'evt-original',
          source_event_type: 'violation',
        },
      });
      mockStore.list.mockResolvedValue([event]);

      const results = await auditIndex.getSessionTimeline('sess-1');

      expect(results[0].summary.audit_record_id).toBe('ar-123');
      expect(results[0].summary.event_id).toBe('evt-original');
      expect(results[0].summary.summary).toBe(event.detail);
    });
  });
});
