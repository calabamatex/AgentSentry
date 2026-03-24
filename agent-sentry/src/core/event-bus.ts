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
  OnAuditLog = 'on_audit_log',
  OnError = 'on_error',
  OnMetric = 'on_metric',
  PreToolUse = 'pre_tool_use',
  PostToolUse = 'post_tool_use',
  PreSession = 'pre_session',
  PostSession = 'post_session',
  PrePlan = 'pre_plan',
  PostPlan = 'post_plan',
  PluginLoaded = 'plugin_loaded',
  PluginUnloaded = 'plugin_unloaded',
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

  emit(eventType: string, payload: EventPayload): void {
    const handlers = this.listeners.get(eventType);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(payload);
      } catch {
        // Swallow handler errors to avoid breaking the bus
      }
    }
  }

  clear(): void {
    this.listeners.clear();
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
