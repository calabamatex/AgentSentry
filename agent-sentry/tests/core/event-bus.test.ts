import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getEventBus,
  subscribe,
  unsubscribe,
  emit,
  EventType,
  EventPayload,
} from '../../src/core/event-bus';

describe('EventBus', () => {
  let bus: ReturnType<typeof getEventBus>;

  beforeEach(() => {
    bus = getEventBus();
    bus.reset();
  });

  describe('subscribe / emit', () => {
    it('delivers payload to subscribed handler', () => {
      const handler = vi.fn();
      bus.subscribe(EventType.OnAuditLog, handler);
      const payload: EventPayload = {
        type: EventType.OnAuditLog,
        timestamp: new Date().toISOString(),
        data: { message: 'test' },
      };
      bus.emit(EventType.OnAuditLog, payload);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(payload);
    });

    it('auto-wraps plain data objects into EventPayload', () => {
      const handler = vi.fn();
      bus.subscribe('custom-event', handler);
      bus.emit('custom-event', { foo: 'bar' });
      expect(handler).toHaveBeenCalledOnce();
      const received = handler.mock.calls[0][0] as EventPayload;
      expect(received.type).toBe('custom-event');
      expect(received.data).toEqual({ foo: 'bar' });
      expect(received.timestamp).toBeDefined();
    });

    it('supports multiple handlers for the same event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.subscribe(EventType.OnError, h1);
      bus.subscribe(EventType.OnError, h2);
      bus.emit(EventType.OnError, { type: EventType.OnError, timestamp: '', data: {} });
      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('does not deliver to handlers for other event types', () => {
      const handler = vi.fn();
      bus.subscribe(EventType.OnError, handler);
      bus.emit(EventType.OnMetric, { type: EventType.OnMetric, timestamp: '', data: {} });
      expect(handler).not.toHaveBeenCalled();
    });

    it('emit is a no-op when no handlers are subscribed', () => {
      // Should not throw
      bus.emit('nonexistent', { some: 'data' });
    });
  });

  describe('unsubscribe', () => {
    it('removes a specific handler', () => {
      const handler = vi.fn();
      bus.subscribe(EventType.OnMetric, handler);
      bus.unsubscribe(EventType.OnMetric, handler);
      bus.emit(EventType.OnMetric, { type: EventType.OnMetric, timestamp: '', data: {} });
      expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribe is safe for non-subscribed handler', () => {
      const handler = vi.fn();
      // Should not throw
      bus.unsubscribe('whatever', handler);
    });

    it('cleans up empty handler sets from the map', () => {
      const handler = vi.fn();
      bus.subscribe('test', handler);
      bus.unsubscribe('test', handler);
      const subs = bus.listSubscribers();
      expect(subs['test']).toBeUndefined();
    });
  });

  describe('error isolation', () => {
    it('swallows synchronous handler errors without breaking other handlers', () => {
      const badHandler = vi.fn(() => { throw new Error('boom'); });
      const goodHandler = vi.fn();
      bus.subscribe('evt', badHandler);
      bus.subscribe('evt', goodHandler);
      bus.emit('evt', { type: 'evt', timestamp: '', data: {} });
      expect(badHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });

    it('swallows async handler rejections', async () => {
      const asyncBad = vi.fn().mockRejectedValue(new Error('async boom'));
      bus.subscribe('evt', asyncBad);
      // Should not throw
      bus.emit('evt', { type: 'evt', timestamp: '', data: {} });
      expect(asyncBad).toHaveBeenCalled();
    });
  });

  describe('clear / reset', () => {
    it('clear removes all listeners', () => {
      bus.subscribe('a', vi.fn());
      bus.subscribe('b', vi.fn());
      bus.clear();
      expect(bus.listSubscribers()).toEqual({});
    });

    it('reset is an alias for clear', () => {
      bus.subscribe('a', vi.fn());
      bus.reset();
      expect(bus.listSubscribers()).toEqual({});
    });
  });

  describe('listSubscribers', () => {
    it('returns counts per event type', () => {
      bus.subscribe('a', vi.fn());
      bus.subscribe('a', vi.fn());
      bus.subscribe('b', vi.fn());
      const subs = bus.listSubscribers();
      expect(subs).toEqual({ a: 2, b: 1 });
    });

    it('returns empty object when no subscribers', () => {
      expect(bus.listSubscribers()).toEqual({});
    });
  });

  describe('convenience functions (module-level)', () => {
    beforeEach(() => {
      getEventBus().reset();
    });

    it('subscribe/emit work at module level', () => {
      const handler = vi.fn();
      subscribe(EventType.PreToolUse, handler);
      emit(EventType.PreToolUse, { tool: 'bash' });
      expect(handler).toHaveBeenCalledOnce();
      const received = handler.mock.calls[0][0] as EventPayload;
      expect(received.type).toBe(EventType.PreToolUse);
      expect(received.data).toEqual({ tool: 'bash' });
    });

    it('unsubscribe works at module level', () => {
      const handler = vi.fn();
      subscribe(EventType.PostSession, handler);
      unsubscribe(EventType.PostSession, handler);
      emit(EventType.PostSession);
      expect(handler).not.toHaveBeenCalled();
    });

    it('emit with no data defaults to empty object', () => {
      const handler = vi.fn();
      subscribe('test', handler);
      emit('test');
      const received = handler.mock.calls[0][0] as EventPayload;
      expect(received.data).toEqual({});
    });
  });
});
