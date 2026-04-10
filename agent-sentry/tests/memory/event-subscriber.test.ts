import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEventBus, EventType, EventPayload } from '../../src/core/event-bus';
import { registerEventSubscriber } from '../../src/memory/event-subscriber';

// Mock the logger
vi.mock('../../src/observability/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('event-subscriber', () => {
  const mockCapture = vi.fn().mockResolvedValue({});
  const mockStore = { capture: mockCapture } as any;

  beforeEach(() => {
    getEventBus().reset();
    vi.clearAllMocks();
  });

  it('subscribes to all EventType values', () => {
    registerEventSubscriber(mockStore, 'sess-1');
    const subs = getEventBus().listSubscribers();
    const allTypes = Object.values(EventType);
    for (const t of allTypes) {
      expect(subs[t]).toBeGreaterThanOrEqual(1);
    }
  });

  it('captures an OnAuditLog event with correct mapping', async () => {
    registerEventSubscriber(mockStore, 'sess-1');
    const bus = getEventBus();

    const payload: EventPayload = {
      type: EventType.OnAuditLog,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { title: 'Audit finding', detail: 'Some detail', severity: 'high', skill: 'proactive_safety' },
    };
    bus.emit(EventType.OnAuditLog, payload);

    // Wait for async handler
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalledOnce());

    const captured = mockCapture.mock.calls[0][0];
    expect(captured.event_type).toBe('audit_finding');
    expect(captured.session_id).toBe('sess-1');
    expect(captured.severity).toBe('high');
    expect(captured.skill).toBe('proactive_safety');
    expect(captured.title).toBe('Audit finding');
    expect(captured.detail).toBe('Some detail');
  });

  it('maps OnError to incident event_type', async () => {
    registerEventSubscriber(mockStore, 'sess-2');
    getEventBus().emit(EventType.OnError, {
      type: EventType.OnError,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { title: 'Err' },
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].event_type).toBe('incident');
  });

  it('maps PostSession to handoff event_type', async () => {
    registerEventSubscriber(mockStore, 'sess-3');
    getEventBus().emit(EventType.PostSession, {
      type: EventType.PostSession,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: {},
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].event_type).toBe('handoff');
  });

  it('defaults severity to low for unknown values', async () => {
    registerEventSubscriber(mockStore, 'sess-4');
    getEventBus().emit(EventType.PreToolUse, {
      type: EventType.PreToolUse,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { severity: 'unknown-level' },
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].severity).toBe('low');
  });

  it('defaults skill to system for unknown values', async () => {
    registerEventSubscriber(mockStore, 'sess-5');
    getEventBus().emit(EventType.PrePlan, {
      type: EventType.PrePlan,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { skill: 'nonexistent-skill' },
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].skill).toBe('system');
  });

  it('truncates title to 120 characters', async () => {
    registerEventSubscriber(mockStore, 'sess-6');
    const longTitle = 'A'.repeat(200);
    getEventBus().emit(EventType.OnMetric, {
      type: EventType.OnMetric,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { title: longTitle },
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].title.length).toBe(120);
  });

  it('defaults title when not provided in data', async () => {
    registerEventSubscriber(mockStore, 'sess-7');
    getEventBus().emit(EventType.PluginLoaded, {
      type: EventType.PluginLoaded,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: {},
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].title).toBe('PluginLoaded event');
  });

  it('uses payload.type as default tag', async () => {
    registerEventSubscriber(mockStore, 'sess-8');
    getEventBus().emit(EventType.PreSession, {
      type: EventType.PreSession,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: {},
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].tags).toEqual([EventType.PreSession]);
  });

  it('uses provided tags when available', async () => {
    registerEventSubscriber(mockStore, 'sess-9');
    getEventBus().emit(EventType.OnMetric, {
      type: EventType.OnMetric,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { tags: ['custom', 'tags'] },
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].tags).toEqual(['custom', 'tags']);
  });

  it('handles capture errors gracefully without throwing', async () => {
    mockCapture.mockRejectedValueOnce(new Error('db write failed'));
    registerEventSubscriber(mockStore, 'sess-err');
    getEventBus().emit(EventType.OnError, {
      type: EventType.OnError,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { title: 'test' },
    });
    // Should not throw - the handler catches errors internally
    await new Promise((r) => setTimeout(r, 50));
  });

  it('defaults agent_id to system when not provided', async () => {
    registerEventSubscriber(mockStore, 'sess-10');
    getEventBus().emit(EventType.OnAuditLog, {
      type: EventType.OnAuditLog,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: {},
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].agent_id).toBe('system');
  });

  it('uses provided agent_id from data', async () => {
    registerEventSubscriber(mockStore, 'sess-11');
    getEventBus().emit(EventType.PreToolUse, {
      type: EventType.PreToolUse,
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { agent_id: 'agent-42' },
    });
    await vi.waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(mockCapture.mock.calls[0][0].agent_id).toBe('agent-42');
  });
});
