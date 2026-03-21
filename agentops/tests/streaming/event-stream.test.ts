import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventStream, StreamClient, StreamEvent, StreamFilter } from '../../src/streaming/event-stream';
import { getEventBus, EventType as BusEventType } from '../../core/event-bus';

function makeClient(overrides: Partial<StreamClient> = {}): StreamClient {
  return {
    id: overrides.id ?? `client-${Math.random().toString(36).slice(2, 8)}`,
    connectedAt: new Date().toISOString(),
    filter: overrides.filter ?? {},
    transport: overrides.transport ?? 'callback',
    send: overrides.send ?? vi.fn(),
    close: overrides.close ?? vi.fn(),
  };
}

function makeEvent(overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: overrides.type ?? 'decision',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    data: overrides.data ?? { title: 'test event' },
  };
}

describe('EventStream', () => {
  let stream: EventStream;

  beforeEach(() => {
    getEventBus().reset();
    stream = new EventStream({ maxClients: 5, bufferSize: 10, heartbeatIntervalMs: 60000 });
  });

  afterEach(() => {
    stream.stop();
  });

  // -----------------------------------------------------------------------
  // Client management
  // -----------------------------------------------------------------------

  describe('client management', () => {
    it('should add and retrieve a client', () => {
      const client = makeClient({ id: 'c1' });
      expect(stream.addClient(client)).toBe(true);
      expect(stream.getClient('c1')).toBe(client);
      expect(stream.getClientCount()).toBe(1);
    });

    it('should remove a client', () => {
      const client = makeClient({ id: 'c1' });
      stream.addClient(client);
      expect(stream.removeClient('c1')).toBe(true);
      expect(stream.getClient('c1')).toBeUndefined();
      expect(stream.getClientCount()).toBe(0);
    });

    it('should return false when removing a non-existent client', () => {
      expect(stream.removeClient('unknown')).toBe(false);
    });

    it('should list all clients', () => {
      stream.addClient(makeClient({ id: 'a' }));
      stream.addClient(makeClient({ id: 'b' }));
      const clients = stream.getClients();
      expect(clients).toHaveLength(2);
      expect(clients.map((c) => c.id).sort()).toEqual(['a', 'b']);
    });
  });

  // -----------------------------------------------------------------------
  // Max client limit
  // -----------------------------------------------------------------------

  describe('max client limit', () => {
    it('should reject clients beyond maxClients', () => {
      for (let i = 0; i < 5; i++) {
        expect(stream.addClient(makeClient({ id: `c${i}` }))).toBe(true);
      }
      expect(stream.addClient(makeClient({ id: 'overflow' }))).toBe(false);
      expect(stream.getClientCount()).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // Publishing
  // -----------------------------------------------------------------------

  describe('publishing', () => {
    it('should send events to all connected clients with no filter', () => {
      const send1 = vi.fn();
      const send2 = vi.fn();
      stream.addClient(makeClient({ id: 'c1', send: send1 }));
      stream.addClient(makeClient({ id: 'c2', send: send2 }));

      const event = makeEvent();
      stream.publish(event);

      expect(send1).toHaveBeenCalledWith(event);
      expect(send2).toHaveBeenCalledWith(event);
    });

    it('should not crash when client send throws', () => {
      stream.addClient(makeClient({
        id: 'c1',
        send: () => { throw new Error('broken'); },
      }));

      expect(() => stream.publish(makeEvent())).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Filter matching
  // -----------------------------------------------------------------------

  describe('filter matching', () => {
    it('should filter by eventTypes', () => {
      const send = vi.fn();
      stream.addClient(makeClient({
        id: 'c1',
        send,
        filter: { eventTypes: ['incident'] },
      }));

      stream.publish(makeEvent({ type: 'decision' }));
      expect(send).not.toHaveBeenCalled();

      stream.publish(makeEvent({ type: 'incident' }));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('should filter by severity', () => {
      const send = vi.fn();
      stream.addClient(makeClient({
        id: 'c1',
        send,
        filter: { severities: ['high', 'critical'] },
      }));

      stream.publish(makeEvent({ data: { severity: 'low' } }));
      expect(send).not.toHaveBeenCalled();

      stream.publish(makeEvent({ data: { severity: 'high' } }));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('should filter by sessionId', () => {
      const send = vi.fn();
      stream.addClient(makeClient({
        id: 'c1',
        send,
        filter: { sessionId: 'sess-42' },
      }));

      stream.publish(makeEvent({ data: { session_id: 'sess-99' } }));
      expect(send).not.toHaveBeenCalled();

      stream.publish(makeEvent({ data: { session_id: 'sess-42' } }));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('should filter by tags (OR matching)', () => {
      const send = vi.fn();
      stream.addClient(makeClient({
        id: 'c1',
        send,
        filter: { tags: ['security'] },
      }));

      stream.publish(makeEvent({ data: { tags: ['perf'] } }));
      expect(send).not.toHaveBeenCalled();

      stream.publish(makeEvent({ data: { tags: ['security', 'audit'] } }));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('should pass events that match all filter criteria', () => {
      const send = vi.fn();
      stream.addClient(makeClient({
        id: 'c1',
        send,
        filter: { eventTypes: ['incident'], severities: ['high'] },
      }));

      // Wrong type
      stream.publish(makeEvent({ type: 'decision', data: { severity: 'high' } }));
      expect(send).not.toHaveBeenCalled();

      // Wrong severity
      stream.publish(makeEvent({ type: 'incident', data: { severity: 'low' } }));
      expect(send).not.toHaveBeenCalled();

      // Both match
      stream.publish(makeEvent({ type: 'incident', data: { severity: 'high' } }));
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Buffer
  // -----------------------------------------------------------------------

  describe('buffer', () => {
    it('should buffer events up to bufferSize', () => {
      for (let i = 0; i < 15; i++) {
        stream.publish(makeEvent({ id: `e${i}` }));
      }
      const buf = stream.getBuffer();
      expect(buf).toHaveLength(10); // bufferSize = 10
      expect(buf[0].id).toBe('e5');
      expect(buf[9].id).toBe('e14');
    });

    it('should return events since a given timestamp', () => {
      const t1 = '2025-01-01T00:00:00.000Z';
      const t2 = '2025-01-01T00:00:01.000Z';
      const t3 = '2025-01-01T00:00:02.000Z';

      stream.publish(makeEvent({ id: 'e1', timestamp: t1 }));
      stream.publish(makeEvent({ id: 'e2', timestamp: t2 }));
      stream.publish(makeEvent({ id: 'e3', timestamp: t3 }));

      const since = stream.getBuffer(t1);
      expect(since).toHaveLength(2);
      expect(since[0].id).toBe('e2');
    });
  });

  // -----------------------------------------------------------------------
  // Replay
  // -----------------------------------------------------------------------

  describe('replay', () => {
    it('should replay buffered events matching the client filter', () => {
      stream.publish(makeEvent({ id: 'e1', type: 'decision' }));
      stream.publish(makeEvent({ id: 'e2', type: 'incident' }));
      stream.publish(makeEvent({ id: 'e3', type: 'decision' }));

      const send = vi.fn();
      stream.addClient(makeClient({
        id: 'c1',
        send,
        filter: { eventTypes: ['decision'] },
      }));

      const count = stream.replay('c1');
      expect(count).toBe(2);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('should return 0 for unknown client', () => {
      expect(stream.replay('unknown')).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  describe('stats', () => {
    it('should report accurate stats', () => {
      stream.addClient(makeClient());
      stream.publish(makeEvent());
      stream.publish(makeEvent());

      const stats = stream.getStats();
      expect(stats.clientCount).toBe(1);
      expect(stats.bufferSize).toBe(2);
      expect(stats.eventsPublished).toBe(2);
      expect(stats.started).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('should subscribe to event bus on start and unsubscribe on stop', async () => {
      stream.start();
      const stats = stream.getStats();
      expect(stats.started).toBe(true);

      const bus = getEventBus();
      const subscribers = bus.listSubscribers();
      expect(subscribers[BusEventType.OnError]).toBeGreaterThanOrEqual(1);

      stream.stop();
      expect(stream.getStats().started).toBe(false);
    });

    it('should forward event bus events to clients', async () => {
      const send = vi.fn();
      stream.start();
      stream.addClient(makeClient({ id: 'c1', send }));

      const bus = getEventBus();
      await bus.emit(BusEventType.OnError, { message: 'test error' });

      expect(send).toHaveBeenCalledTimes(1);
      const sentEvent = send.mock.calls[0][0];
      expect(sentEvent.type).toBe('OnError');
      expect(sentEvent.data.message).toBe('test error');
    });

    it('should close all clients on stop', () => {
      const close = vi.fn();
      stream.addClient(makeClient({ id: 'c1', close }));
      stream.addClient(makeClient({ id: 'c2', close }));

      stream.start();
      stream.stop();

      expect(close).toHaveBeenCalledTimes(2);
      expect(stream.getClientCount()).toBe(0);
    });

    it('should be idempotent for start and stop', () => {
      stream.start();
      stream.start(); // No-op
      expect(stream.getStats().started).toBe(true);

      stream.stop();
      stream.stop(); // No-op
      expect(stream.getStats().started).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  describe('heartbeat', () => {
    it('should send heartbeat events to clients', async () => {
      const shortStream = new EventStream({ heartbeatIntervalMs: 50 });
      const send = vi.fn();
      shortStream.start();
      shortStream.addClient(makeClient({ id: 'c1', send }));

      // Wait for at least one heartbeat
      await new Promise((resolve) => setTimeout(resolve, 120));

      shortStream.stop();

      const heartbeats = send.mock.calls.filter(
        (call) => call[0].type === 'heartbeat',
      );
      expect(heartbeats.length).toBeGreaterThanOrEqual(1);
    });
  });
});
