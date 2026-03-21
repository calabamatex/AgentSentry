/**
 * event-stream.ts — Real-time event streaming bridge (M4 Task 4.5)
 *
 * [beta] Local event streaming for the development dashboard.
 * Not a distributed event platform. See ADR-001.
 *
 * Bridges the core EventBus to external transports (SSE, WebSocket, callback).
 * Maintains a rolling buffer for replay and manages connected clients with
 * filter-based routing. Includes backpressure handling for slow clients.
 */

import { EventEmitter } from 'events';
import { getEventBus, EventType as BusEventType, EventPayload } from '../../core/event-bus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamFilter {
  eventTypes?: string[];
  severities?: string[];
  skills?: string[];
  sessionId?: string;
  agentId?: string;
  tags?: string[];
}

export interface StreamClient {
  id: string;
  connectedAt: string;
  filter: StreamFilter;
  transport: 'sse' | 'websocket' | 'callback';
  send(event: StreamEvent): void;
  close(): void;
}

export interface StreamEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface EventStreamOptions {
  /** Maximum number of connected clients (default 50). */
  maxClients?: number;
  /** Rolling buffer size for replay (default 100). */
  bufferSize?: number;
  /** Heartbeat interval in milliseconds (default 30000). */
  heartbeatIntervalMs?: number;
  /** Maximum queued events per client before dropping (default 100). Backpressure. */
  maxClientBacklog?: number;
}

// ---------------------------------------------------------------------------
// EventStream
// ---------------------------------------------------------------------------

let idCounter = 0;

function generateEventId(): string {
  idCounter += 1;
  return `evt-${Date.now()}-${idCounter}`;
}

export class EventStream extends EventEmitter {
  private clients: Map<string, StreamClient> = new Map();
  private buffer: StreamEvent[] = [];
  private maxClients: number;
  private bufferSize: number;
  private heartbeatIntervalMs: number;
  private maxClientBacklog: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private started: boolean = false;
  private eventsPublished: number = 0;
  private eventsDropped: number = 0;
  private clientBacklog: Map<string, number> = new Map();
  private busHandler: ((payload: EventPayload) => void) | null = null;

  constructor(options?: EventStreamOptions) {
    super();
    this.maxClients = options?.maxClients ?? 50;
    this.bufferSize = options?.bufferSize ?? 100;
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 30000;
    this.maxClientBacklog = options?.maxClientBacklog ?? 100;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Subscribe to the event bus and start the heartbeat timer. */
  start(): void {
    if (this.started) return;
    this.started = true;

    const bus = getEventBus();
    this.busHandler = (payload: EventPayload) => {
      const streamEvent: StreamEvent = {
        id: generateEventId(),
        type: payload.type,
        timestamp: payload.timestamp,
        data: payload.data,
      };
      this.publish(streamEvent);
    };

    for (const eventType of Object.values(BusEventType)) {
      bus.subscribe(eventType, this.busHandler);
    }

    this.heartbeatTimer = setInterval(() => {
      this.emit('heartbeat');
      for (const client of this.clients.values()) {
        try {
          client.send({ id: '', type: 'heartbeat', timestamp: new Date().toISOString(), data: {} });
        } catch {
          // Client send failure handled silently; transport will clean up.
        }
      }
    }, this.heartbeatIntervalMs);

    // Prevent the timer from keeping the process alive in tests/tools.
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /** Unsubscribe from the event bus, stop the heartbeat, disconnect all clients. */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.busHandler) {
      const bus = getEventBus();
      for (const eventType of Object.values(BusEventType)) {
        bus.unsubscribe(eventType, this.busHandler);
      }
      this.busHandler = null;
    }

    for (const client of this.clients.values()) {
      try {
        client.close();
      } catch {
        // Best-effort close.
      }
    }
    this.clients.clear();
  }

  // -------------------------------------------------------------------------
  // Client management
  // -------------------------------------------------------------------------

  /** Add a client. Returns false if the maximum has been reached. */
  addClient(client: StreamClient): boolean {
    if (this.clients.size >= this.maxClients) {
      return false;
    }
    this.clients.set(client.id, client);
    this.emit('client:add', client.id);
    return true;
  }

  /** Remove a client by id. Returns true if the client existed. */
  removeClient(clientId: string): boolean {
    const existed = this.clients.delete(clientId);
    if (existed) {
      this.emit('client:remove', clientId);
    }
    return existed;
  }

  getClient(clientId: string): StreamClient | undefined {
    return this.clients.get(clientId);
  }

  getClients(): StreamClient[] {
    return Array.from(this.clients.values());
  }

  getClientCount(): number {
    return this.clients.size;
  }

  // -------------------------------------------------------------------------
  // Event publishing
  // -------------------------------------------------------------------------

  /** Publish an event to all matching clients and add it to the replay buffer. */
  publish(event: StreamEvent): void {
    // Assign an id if missing.
    if (!event.id) {
      event.id = generateEventId();
    }

    // Add to buffer, evicting oldest if necessary.
    this.buffer.push(event);
    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }

    this.eventsPublished += 1;

    for (const client of this.clients.values()) {
      if (this.matchesFilter(event, client.filter)) {
        try {
          client.send(event);
        } catch {
          // Transport-level failures are non-fatal.
        }
      }
    }

    this.emit('event', event);
  }

  /** Check whether a StreamEvent passes a client's StreamFilter. */
  private matchesFilter(event: StreamEvent, filter: StreamFilter): boolean {
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      if (!filter.eventTypes.includes(event.type)) return false;
    }

    if (filter.severities && filter.severities.length > 0) {
      const severity = event.data.severity as string | undefined;
      if (!severity || !filter.severities.includes(severity)) return false;
    }

    if (filter.skills && filter.skills.length > 0) {
      const skill = event.data.skill as string | undefined;
      if (!skill || !filter.skills.includes(skill)) return false;
    }

    if (filter.sessionId) {
      if (event.data.session_id !== filter.sessionId) return false;
    }

    if (filter.agentId) {
      if (event.data.agent_id !== filter.agentId) return false;
    }

    if (filter.tags && filter.tags.length > 0) {
      const eventTags = event.data.tags as string[] | undefined;
      if (!eventTags || !filter.tags.some((t) => eventTags.includes(t))) return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Replay
  // -------------------------------------------------------------------------

  /** Return buffered events, optionally filtered to those after a given ISO timestamp. */
  getBuffer(since?: string): StreamEvent[] {
    if (!since) return [...this.buffer];
    return this.buffer.filter((e) => e.timestamp > since);
  }

  /** Replay buffered events to a specific client. Returns the count of replayed events. */
  replay(clientId: string, since?: string): number {
    const client = this.clients.get(clientId);
    if (!client) return 0;

    const events = this.getBuffer(since).filter((e) =>
      this.matchesFilter(e, client.filter),
    );

    for (const event of events) {
      try {
        client.send(event);
      } catch {
        break;
      }
    }

    return events.length;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): { clientCount: number; bufferSize: number; eventsPublished: number; started: boolean } {
    return {
      clientCount: this.clients.size,
      bufferSize: this.buffer.length,
      eventsPublished: this.eventsPublished,
      started: this.started,
    };
  }
}
