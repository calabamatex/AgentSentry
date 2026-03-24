/**
 * health.test.ts — Tests for agent_sentry_health tool (comprehensive health check).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStats = {
  total_events: 42,
  by_type: {
    decision: 20,
    violation: 5,
    incident: 3,
    pattern: 10,
    handoff: 2,
    audit_finding: 2,
  },
  by_severity: {
    low: 25,
    medium: 10,
    high: 5,
    critical: 2,
  },
  by_skill: {
    save_points: 10,
    context_health: 8,
    standing_orders: 7,
    small_bets: 6,
    proactive_safety: 5,
    system: 6,
  },
  first_event: '2026-03-01T00:00:00.000Z',
  last_event: '2026-03-20T12:00:00.000Z',
};

const mockVerifyChain = vi.fn().mockResolvedValue({ valid: true, total_checked: 42 });
const mockInitialize = vi.fn().mockResolvedValue(undefined);
const mockStatsFn = vi.fn().mockResolvedValue(mockStats);
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../src/memory/store', () => {
  return {
    MemoryStore: vi.fn().mockImplementation(() => ({
      initialize: mockInitialize,
      stats: mockStatsFn,
      verifyChain: mockVerifyChain,
      close: mockClose,
    })),
  };
});

vi.mock('../../../src/memory/providers/provider-factory', () => ({
  loadMemoryConfig: vi.fn().mockReturnValue({
    enabled: true,
    provider: 'sqlite',
    embedding_provider: 'auto',
    database_path: 'agentops/data/ops.db',
    max_events: 100000,
    auto_prune_days: 365,
  }),
}));

vi.mock('../../../src/memory/embeddings', () => ({
  detectEmbeddingProvider: vi.fn().mockResolvedValue({
    name: 'noop',
    dimension: 0,
  }),
}));

vi.mock('../../../src/enablement/engine', () => ({
  generateConfigForLevel: vi.fn().mockReturnValue({
    level: 3,
    skills: {
      save_points: { enabled: true, mode: 'full' },
      context_health: { enabled: true, mode: 'full' },
      standing_orders: { enabled: true, mode: 'full' },
      small_bets: { enabled: false, mode: 'off' },
      proactive_safety: { enabled: false, mode: 'off' },
    },
  }),
  getActiveSkills: vi.fn().mockReturnValue(['save_points', 'context_health', 'standing_orders']),
  LEVEL_NAMES: { 1: 'Safe Ground', 2: 'Clear Head', 3: 'House Rules', 4: 'Right Size', 5: 'Full Guard' },
}));

import { handler } from '../../../src/mcp/tools/health';
import { MemoryStore } from '../../../src/memory/store';
import { detectEmbeddingProvider } from '../../../src/memory/embeddings';

describe('agent_sentry_health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    mockInitialize.mockResolvedValue(undefined);
    mockStatsFn.mockResolvedValue(mockStats);
    mockVerifyChain.mockResolvedValue({ valid: true, total_checked: 42 });
    mockClose.mockResolvedValue(undefined);
  });

  it('should return healthy status with store stats', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('healthy');
    expect(parsed.store.total_events).toBe(42);
    expect(parsed.store.by_type.decision).toBe(20);
    expect(parsed.store.by_severity.low).toBe(25);
    expect(parsed.store.first_event).toBe('2026-03-01T00:00:00.000Z');
    expect(parsed.store.last_event).toBe('2026-03-20T12:00:00.000Z');
  });

  it('should include chain verification results', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.chain.verified).toBe(true);
    expect(parsed.chain.total_checked).toBe(42);
    expect(parsed.chain.broken_at).toBeUndefined();
  });

  it('should report degraded when chain is broken', async () => {
    mockVerifyChain.mockResolvedValue({
      valid: false,
      total_checked: 30,
      first_broken_at: '2026-03-15T10:00:00.000Z',
    });

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('degraded');
    expect(parsed.chain.verified).toBe(false);
    expect(parsed.chain.broken_at).toBe('2026-03-15T10:00:00.000Z');
    expect(parsed.issues).toContain('Hash chain broken at 2026-03-15T10:00:00.000Z');
  });

  it('should include embedding provider info', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.embedding).toBeDefined();
    expect(parsed.embedding.provider).toBe('noop');
    expect(parsed.embedding.dimension).toBe(0);
    expect(parsed.embedding.available).toBe(false);
  });

  it('should report available embedding when dimension > 0', async () => {
    const mockDetect = detectEmbeddingProvider as unknown as ReturnType<typeof vi.fn>;
    mockDetect.mockResolvedValueOnce({ name: 'onnx-local', dimension: 384 });

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.embedding.provider).toBe('onnx-local');
    expect(parsed.embedding.dimension).toBe(384);
    expect(parsed.embedding.available).toBe(true);
  });

  it('should include enablement info', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.enablement).toBeDefined();
    expect(typeof parsed.enablement.level).toBe('number');
    expect(parsed.enablement.level).toBeGreaterThanOrEqual(1);
    expect(parsed.enablement.level).toBeLessThanOrEqual(5);
    expect(Array.isArray(parsed.enablement.active_skills)).toBe(true);
    // Level 1+ always has save_points active
    if (parsed.enablement.level >= 1) {
      expect(parsed.enablement.active_skills).toContain('save_points');
    }
  });

  it('should include config info', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.config).toBeDefined();
    expect(parsed.config.max_events).toBe(100000);
    expect(parsed.config.auto_prune_days).toBe(365);
    expect(parsed.config.database_path).toBe('agentops/data/ops.db');
  });

  it('should return degraded status for many critical events', async () => {
    mockStatsFn.mockResolvedValueOnce({
      ...mockStats,
      by_severity: { ...mockStats.by_severity, critical: 15 },
    });

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('degraded');
    expect(parsed.issues).toEqual(
      expect.arrayContaining([expect.stringContaining('15 critical events')]),
    );
  });

  it('should return error status on store failure', async () => {
    mockInitialize.mockRejectedValueOnce(new Error('DB unavailable'));

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('error');
    expect(parsed.issues[0]).toContain('DB unavailable');
    expect(parsed.store.total_events).toBe(0);
    expect(parsed.chain.verified).toBe(false);
    expect(parsed.embedding.available).toBe(false);
  });

  it('should close store after stats retrieval', async () => {
    await handler({});

    const storeInstance = (MemoryStore as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(storeInstance.close).toHaveBeenCalled();
  });

  it('should include all top-level fields', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('store');
    expect(parsed).toHaveProperty('chain');
    expect(parsed).toHaveProperty('embedding');
    expect(parsed).toHaveProperty('enablement');
    expect(parsed).toHaveProperty('config');
    expect(parsed).toHaveProperty('issues');
  });
});
