/**
 * event-bus.ts — Lightweight in-process event bus for AgentSentry.
 *
 * Provides typed pub/sub for internal events (audit logs, tool use, sessions,
 * plugins). Consumed by streaming/event-stream.ts and memory/event-subscriber.ts.
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export enum EventType {
  OnAuditLog = 'OnAuditLog',
  OnError = 'OnError',
  OnMetric = 'OnMetric',
  PreToolUse = 'PreToolUse',
  PostToolUse = 'PostToolUse',
  PreSession = 'PreSession',
  PostSession = 'PostSession',
  PrePlan = 'PrePlan',
  PostPlan = 'PostPlan',
  PluginLoaded = 'PluginLoaded',
  PluginUnloaded = 'PluginUnloaded',
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface EventPayload {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Handler type
// ---------------------------------------------------------------------------

export type EventHandler = (payload: EventPayload) => void | Promise<void>;

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

class EventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  subscribe(eventType: string, handler: EventHandler): void {
    let handlers = this.listeners.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(eventType, handlers);
    }
    handlers.add(handler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  emit(eventType: string, payloadOrData: EventPayload | Record<string, unknown>): void {
    const payload: EventPayload = 'type' in payloadOrData && 'timestamp' in payloadOrData
      ? payloadOrData as EventPayload
      : { type: eventType, timestamp: new Date().toISOString(), data: payloadOrData as Record<string, unknown> };

    const handlers = this.listeners.get(eventType);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        const result = handler(payload);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch(() => {
            // Swallow async handler errors to avoid breaking the bus
          });
        }
      } catch {
        // Swallow handler errors to avoid breaking the bus
      }
    }
  }

  /** Remove all listeners. */
  clear(): void {
    this.listeners.clear();
  }

  /** Alias for clear() — used in tests. */
  reset(): void {
    this.clear();
  }

  /** Return subscriber count per event type. */
  listSubscribers(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [eventType, handlers] of this.listeners) {
      result[eventType] = handlers.size;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBus();
  }
  return instance;
}

/**
 * Convenience: subscribe to a specific event type on the global bus.
 */
export function subscribe(eventType: string, handler: EventHandler): void {
  getEventBus().subscribe(eventType, handler);
}

/**
 * Convenience: unsubscribe from a specific event type on the global bus.
 */
export function unsubscribe(eventType: string, handler: EventHandler): void {
  getEventBus().unsubscribe(eventType, handler);
}

/**
 * Convenience: emit an event on the global bus.
 */
export function emit(eventType: string, data: Record<string, unknown> = {}): void {
  getEventBus().emit(eventType, {
    type: eventType,
    timestamp: new Date().toISOString(),
    data,
  });
}
