import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpsEvent, computeHash } from '../../../src/memory/schema';

// Mock https and http modules before importing the provider
const mockRequestFn = vi.fn();
const mockWriteFn = vi.fn();
const mockEndFn = vi.fn();
const mockOnFn = vi.fn();

function createMockResponse(statusCode: number, body: string, headers: Record<string, string> = {}) {
  const dataHandlers: ((chunk: Buffer) => void)[] = [];
  const endHandlers: (() => void)[] = [];

  return {
    statusCode,
    headers,
    on: (event: string, handler: any) => {
      if (event === 'data') dataHandlers.push(handler);
      if (event === 'end') endHandlers.push(handler);
    },
    _emit: () => {
      for (const h of dataHandlers) h(Buffer.from(body));
      for (const h of endHandlers) h();
    },
  };
}

function setupMockRequest(responses: Array<{ statusCode: number; body: string; headers?: Record<string, string> }>) {
  let callIndex = 0;
  mockRequestFn.mockImplementation((_opts: any, callback: any) => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    const mockRes = createMockResponse(resp.statusCode, resp.body, resp.headers ?? {});
    // Schedule callback for next tick to simulate async
    setTimeout(() => {
      callback(mockRes);
      mockRes._emit();
    }, 0);
    return {
      write: mockWriteFn,
      end: mockEndFn,
      on: mockOnFn,
    };
  });
}

vi.mock('https', () => ({
  request: (...args: any[]) => mockRequestFn(...args),
}));

vi.mock('http', () => ({
  request: (...args: any[]) => mockRequestFn(...args),
}));

// Import after mocks are set up
import { SupabaseProvider } from '../../../src/memory/providers/supabase-provider';

function makeOpsEvent(overrides: Partial<OpsEvent> = {}): OpsEvent {
  const base = {
    id: 'test-' + Math.random().toString(36).slice(2, 10),
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    agent_id: 'agent-1',
    event_type: 'decision' as const,
    severity: 'low' as const,
    skill: 'system' as const,
    title: 'Test event',
    detail: 'Test detail',
    affected_files: ['src/test.ts'],
    tags: ['test'],
    metadata: {},
    prev_hash: '0'.repeat(64),
    ...overrides,
  };
  const hash = overrides.hash ?? computeHash(base);
  return { ...base, hash };
}

const SUPABASE_URL = 'https://test-project.supabase.co';
const SUPABASE_KEY = 'test-service-role-key-123';

describe('SupabaseProvider', () => {
  let provider: SupabaseProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnFn.mockReturnThis();
    provider = new SupabaseProvider({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_KEY });
  });

  afterEach(async () => {
    await provider.close();
  });

  it('has name "supabase" and mode "remote"', () => {
    expect(provider.name).toBe('supabase');
    expect(provider.mode).toBe('remote');
  });

  describe('initialize', () => {
    it('calls ensure_ops_schema RPC on initialize', async () => {
      setupMockRequest([{ statusCode: 200, body: 'null' }]);
      await provider.initialize();

      expect(mockRequestFn).toHaveBeenCalledTimes(1);
      const callOpts = mockRequestFn.mock.calls[0][0];
      expect(callOpts.path).toBe('/rest/v1/rpc/ensure_ops_schema');
      expect(callOpts.method).toBe('POST');
      expect(callOpts.headers.apikey).toBe(SUPABASE_KEY);
      expect(callOpts.headers.Authorization).toBe(`Bearer ${SUPABASE_KEY}`);
    });

    it('does not throw if RPC fails', async () => {
      setupMockRequest([{ statusCode: 500, body: '{"error":"function not found"}' }]);
      // The RPC will throw due to 500, but initialize catches it and logs via Logger
      await expect(provider.initialize()).resolves.not.toThrow();
    });

    it('throws if URL or key are missing', async () => {
      const badProvider = new SupabaseProvider({ url: '', serviceRoleKey: '' });
      await expect(badProvider.initialize()).rejects.toThrow('SUPABASE_URL');
    });
  });

  describe('insert', () => {
    it('sends correct POST to /rest/v1/ops_events', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' }, // initialize
        { statusCode: 201, body: '' },     // insert
      ]);
      await provider.initialize();

      const event = makeOpsEvent();
      await provider.insert(event);

      expect(mockRequestFn).toHaveBeenCalledTimes(2);
      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toBe('/rest/v1/ops_events');
      expect(callOpts.method).toBe('POST');

      const writtenBody = JSON.parse(mockWriteFn.mock.calls[1][0]);
      expect(writtenBody.id).toBe(event.id);
      expect(writtenBody.session_id).toBe(event.session_id);
      expect(writtenBody.event_type).toBe(event.event_type);
    });

    it('includes embedding as pgvector string when present', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 201, body: '' },
      ]);
      await provider.initialize();

      const event = makeOpsEvent({ embedding: [0.1, 0.2, 0.3] });
      await provider.insert(event);

      const writtenBody = JSON.parse(mockWriteFn.mock.calls[1][0]);
      expect(writtenBody.embedding).toBe('[0.1,0.2,0.3]');
    });
  });

  describe('getById', () => {
    it('sends GET with id=eq. filter and returns event', async () => {
      const event = makeOpsEvent({ id: 'evt-123' });
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: JSON.stringify([event]) },
      ]);
      await provider.initialize();

      const result = await provider.getById('evt-123');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('evt-123');

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toContain('id=eq.evt-123');
      expect(callOpts.method).toBe('GET');
    });

    it('returns null when event not found', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]' },
      ]);
      await provider.initialize();

      const result = await provider.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('query', () => {
    it('builds correct PostgREST query params', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]' },
      ]);
      await provider.initialize();

      await provider.query({
        event_type: 'decision',
        severity: 'high',
        skill: 'system',
        session_id: 'sess-1',
        limit: 50,
        offset: 10,
      });

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toContain('event_type=eq.decision');
      expect(callOpts.path).toContain('severity=eq.high');
      expect(callOpts.path).toContain('skill=eq.system');
      expect(callOpts.path).toContain('session_id=eq.sess-1');
      expect(callOpts.path).toContain('limit=50');
      expect(callOpts.path).toContain('offset=10');
      expect(callOpts.path).toContain('order=timestamp.desc');
    });

    it('applies default limit and offset', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]' },
      ]);
      await provider.initialize();

      await provider.query({});

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toContain('limit=100');
      expect(callOpts.path).toContain('offset=0');
    });

    it('handles tag filter with cs. operator', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]' },
      ]);
      await provider.initialize();

      await provider.query({ tag: 'security' });

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toContain('tags=cs.%5B%22security%22%5D');
    });
  });

  describe('count', () => {
    it('uses Prefer: count=exact header and parses content-range', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]', headers: { 'content-range': '0-0/42' } },
      ]);
      await provider.initialize();

      const result = await provider.count({ event_type: 'decision' });
      expect(result).toBe(42);

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.headers.Prefer).toBe('count=exact');
    });

    it('returns 0 when content-range is missing', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]', headers: {} },
      ]);
      await provider.initialize();

      const result = await provider.count({});
      expect(result).toBe(0);
    });
  });

  describe('vectorSearch', () => {
    it('calls match_ops_events RPC with correct params', async () => {
      const mockResults = [
        {
          ...makeOpsEvent({ id: 'vec-1' }),
          similarity: 0.95,
        },
      ];
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: JSON.stringify(mockResults) },
      ]);
      await provider.initialize();

      const embedding = new Array(384).fill(0.1);
      const results = await provider.vectorSearch(embedding, {
        limit: 5,
        threshold: 0.7,
        event_type: 'decision',
        session_id: 'sess-1',
      });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toBe('/rest/v1/rpc/match_ops_events');

      const writtenBody = JSON.parse(mockWriteFn.mock.calls[1][0]);
      expect(writtenBody.match_count).toBe(5);
      expect(writtenBody.match_threshold).toBe(0.7);
      expect(writtenBody.filter_event_type).toBe('decision');
      expect(writtenBody.filter_session_id).toBe('sess-1');
      expect(writtenBody.query_embedding).toContain('0.1');
    });
  });

  describe('aggregate', () => {
    it('makes count queries for total, types, severities, and skills', async () => {
      // initialize + total count + 6 types + 4 severities + 6 skills + first + last = 19 calls
      const countResponse = { statusCode: 200, body: '[]', headers: { 'content-range': '*/5' } };
      const rowResponse = { statusCode: 200, body: JSON.stringify([{ timestamp: '2025-01-01T00:00:00Z' }]) };
      const responses = [
        { statusCode: 200, body: 'null' },  // initialize
        ...Array(17).fill(countResponse),     // count queries
        rowResponse,                          // first event
        rowResponse,                          // last event
      ];
      setupMockRequest(responses);
      await provider.initialize();

      const stats = await provider.aggregate({});
      expect(stats.total_events).toBe(5);
      expect(stats.first_event).toBe('2025-01-01T00:00:00Z');
      expect(stats.last_event).toBe('2025-01-01T00:00:00Z');
    });
  });

  describe('getChain', () => {
    it('orders by timestamp ASC', async () => {
      const events = [makeOpsEvent(), makeOpsEvent()];
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: JSON.stringify(events) },
      ]);
      await provider.initialize();

      const result = await provider.getChain();
      expect(result).toHaveLength(2);

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toContain('order=timestamp.asc');
    });

    it('filters by since when provided', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]' },
      ]);
      await provider.initialize();

      await provider.getChain('2025-01-01T00:00:00Z');

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toContain('timestamp=gte.');
    });
  });

  describe('prune', () => {
    it('sends DELETE for maxAgeDays with timestamp filter', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: JSON.stringify([{ id: 'old-1' }]) }, // delete result
      ]);
      await provider.initialize();

      const result = await provider.prune({ maxAgeDays: 30 });
      expect(result.deleted).toBe(1);

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.method).toBe('DELETE');
      expect(callOpts.path).toContain('timestamp=lt.');
    });

    it('sends DELETE for maxEvents keeping newest', async () => {
      const countResponse = { statusCode: 200, body: '[]', headers: { 'content-range': '*/15' } };
      const oldRows = [
        { id: '00000000-0000-0000-0000-000000000001' },
        { id: '00000000-0000-0000-0000-000000000002' },
        { id: '00000000-0000-0000-0000-000000000003' },
        { id: '00000000-0000-0000-0000-000000000004' },
        { id: '00000000-0000-0000-0000-000000000005' },
      ];
      setupMockRequest([
        { statusCode: 200, body: 'null' },                     // initialize
        countResponse,                                           // count
        { statusCode: 200, body: JSON.stringify(oldRows) },     // get oldest
        { statusCode: 200, body: JSON.stringify(oldRows) },     // delete result
      ]);
      await provider.initialize();

      const result = await provider.prune({ maxEvents: 10 });
      expect(result.deleted).toBe(5);
    });
  });

  describe('saveChainCheckpoint', () => {
    it('sends POST to chain_checkpoints', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 201, body: '' },
      ]);
      await provider.initialize();

      await provider.saveChainCheckpoint({
        lastEventId: 'evt-99',
        lastEventHash: 'hash-99',
        eventsVerified: 99,
      });

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toBe('/rest/v1/chain_checkpoints');
      expect(callOpts.method).toBe('POST');

      const writtenBody = JSON.parse(mockWriteFn.mock.calls[1][0]);
      expect(writtenBody.last_event_id).toBe('evt-99');
      expect(writtenBody.last_event_hash).toBe('hash-99');
      expect(writtenBody.events_verified).toBe(99);
    });
  });

  describe('getLastChainCheckpoint', () => {
    it('returns last checkpoint ordered by id desc', async () => {
      const checkpoint = {
        id: 5,
        verified_at: '2025-06-01T00:00:00Z',
        last_event_id: 'evt-50',
        last_event_hash: 'hash-50',
        events_verified: 50,
      };
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: JSON.stringify([checkpoint]) },
      ]);
      await provider.initialize();

      const result = await provider.getLastChainCheckpoint();
      expect(result).not.toBeNull();
      expect(result!.lastEventId).toBe('evt-50');
      expect(result!.lastEventHash).toBe('hash-50');
      expect(result!.eventsVerified).toBe(50);
      expect(result!.verifiedAt).toBe('2025-06-01T00:00:00Z');

      const callOpts = mockRequestFn.mock.calls[1][0];
      expect(callOpts.path).toContain('order=id.desc');
      expect(callOpts.path).toContain('limit=1');
    });

    it('returns null when no checkpoints exist', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: '[]' },
      ]);
      await provider.initialize();

      const result = await provider.getLastChainCheckpoint();
      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('rejects on non-200 response', async () => {
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 404, body: '{"message":"Not Found"}' },
      ]);
      await provider.initialize();

      await expect(provider.getById('nonexistent')).rejects.toThrow('Supabase API error 404');
    });

    it('rejects on network error', async () => {
      setupMockRequest([{ statusCode: 200, body: 'null' }]);
      await provider.initialize();

      // Override for network error — use mockImplementation (not Once) so retries also fail
      mockRequestFn.mockImplementation((_opts: any, _callback: any) => {
        const req = {
          write: mockWriteFn,
          end: mockEndFn,
          on: (event: string, handler: any) => {
            if (event === 'error') {
              setTimeout(() => handler(new Error('ECONNREFUSED')), 0);
            }
            return req;
          },
        };
        return req;
      });

      await expect(provider.getById('any')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('env var fallback', () => {
    it('reads from SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars', () => {
      const origUrl = process.env.SUPABASE_URL;
      const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      process.env.SUPABASE_URL = 'https://env-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'env-key-456';

      const envProvider = new SupabaseProvider();
      expect(envProvider.name).toBe('supabase');

      // Restore
      if (origUrl !== undefined) process.env.SUPABASE_URL = origUrl;
      else delete process.env.SUPABASE_URL;
      if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    });
  });

  describe('rowToEvent', () => {
    it('handles JSONB fields that are already parsed objects', async () => {
      const rawRow = {
        id: 'evt-1',
        timestamp: '2025-01-01T00:00:00Z',
        session_id: 'sess-1',
        agent_id: 'agent-1',
        event_type: 'decision',
        severity: 'low',
        skill: 'system',
        title: 'Test',
        detail: 'Detail',
        affected_files: ['file.ts'],  // Already parsed by PostgREST
        tags: ['tag1'],
        metadata: { key: 'value' },
        hash: 'abc',
        prev_hash: 'def',
      };
      setupMockRequest([
        { statusCode: 200, body: 'null' },
        { statusCode: 200, body: JSON.stringify([rawRow]) },
      ]);
      await provider.initialize();

      const result = await provider.getById('evt-1');
      expect(result).not.toBeNull();
      expect(result!.affected_files).toEqual(['file.ts']);
      expect(result!.tags).toEqual(['tag1']);
      expect(result!.metadata).toEqual({ key: 'value' });
    });
  });

  describe('close', () => {
    it('is a no-op and does not throw', async () => {
      await expect(provider.close()).resolves.not.toThrow();
    });
  });
});
