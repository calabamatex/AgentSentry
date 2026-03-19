/**
 * event-bus.ts — AgentOps Event Bus (§21.3)
 *
 * Central publish/subscribe system for hook events. Uses a singleton
 * pattern so all consumers share a single bus instance within a process.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All recognised hook events in the system. */
export enum EventType {
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  PreSession = "PreSession",
  PostSession = "PostSession",
  PrePlan = "PrePlan",
  PostPlan = "PostPlan",
  OnError = "OnError",
  OnMetric = "OnMetric",
  OnAuditLog = "OnAuditLog",
  PluginLoaded = "PluginLoaded",
  PluginUnloaded = "PluginUnloaded",
}

/** Payload delivered with every emitted event. */
export interface EventPayload {
  /** The event that triggered this payload. */
  type: EventType;
  /** ISO-8601 timestamp of emission. */
  timestamp: string;
  /** Arbitrary data supplied by the emitter. */
  data: Record<string, unknown>;
}

/** Callback signature for event subscribers. */
export type EventHandler = (payload: EventPayload) => void | Promise<void>;

// ---------------------------------------------------------------------------
// EventBus implementation
// ---------------------------------------------------------------------------

class EventBus {
  private subscribers: Map<EventType, Set<EventHandler>>;

  constructor() {
    this.subscribers = new Map();
  }

  /**
   * Register a handler for the given event type.
   * The same handler reference will only be registered once per event type.
   */
  subscribe(eventType: EventType, handler: EventHandler): void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);
  }

  /**
   * Remove a previously registered handler for the given event type.
   * Returns `true` if the handler was found and removed, `false` otherwise.
   */
  unsubscribe(eventType: EventType, handler: EventHandler): boolean {
    const handlers = this.subscribers.get(eventType);
    if (!handlers) return false;
    const removed = handlers.delete(handler);
    if (handlers.size === 0) {
      this.subscribers.delete(eventType);
    }
    return removed;
  }

  /**
   * Emit an event, invoking every subscribed handler with the built payload.
   * Handlers are called concurrently via `Promise.allSettled`; a single
   * failing handler will not prevent others from executing.
   */
  async emit(
    eventType: EventType,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const handlers = this.subscribers.get(eventType);
    if (!handlers || handlers.size === 0) return;

    const payload: EventPayload = {
      type: eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    const results = await Promise.allSettled(
      Array.from(handlers).map((handler) => handler(payload)),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          `[AgentOps] EventBus handler error on ${eventType}:`,
          result.reason,
        );
      }
    }
  }

  /**
   * Return a snapshot of all current subscriptions, keyed by event type.
   * Useful for debugging and introspection.
   */
  listSubscribers(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const [eventType, handlers] of this.subscribers) {
      summary[eventType] = handlers.size;
    }
    return summary;
  }

  /**
   * Remove all subscribers. Primarily useful in tests.
   */
  reset(): void {
    this.subscribers.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: EventBus | null = null;

/**
 * Return the singleton EventBus instance, creating it on first call.
 */
export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBus();
  }
  return instance;
}

// ---------------------------------------------------------------------------
// Convenience re-exports that operate on the singleton
// ---------------------------------------------------------------------------

export function subscribe(eventType: EventType, handler: EventHandler): void {
  getEventBus().subscribe(eventType, handler);
}

export function unsubscribe(
  eventType: EventType,
  handler: EventHandler,
): boolean {
  return getEventBus().unsubscribe(eventType, handler);
}

export async function emit(
  eventType: EventType,
  data?: Record<string, unknown>,
): Promise<void> {
  return getEventBus().emit(eventType, data);
}

export function listSubscribers(): Record<string, number> {
  return getEventBus().listSubscribers();
}
