/**
 * Example: Implementing a custom StorageProvider.
 *
 * AgentSentry's MemoryStore accepts any class implementing the StorageProvider
 * interface. This example shows a minimal in-memory provider.
 */

import type {
  OpsEvent,
  SearchResult,
  OpsStats,
  EventType,
  Severity,
  Skill,
} from 'agent-sentry';

// The StorageProvider interface requires these methods:
interface StorageProvider {
  readonly name: string;
  readonly mode: 'local' | 'remote';
  initialize(): Promise<void>;
  close(): Promise<void>;
  insert(event: OpsEvent): Promise<void>;
  getById(id: string): Promise<OpsEvent | null>;
  query(options: Record<string, unknown>): Promise<OpsEvent[]>;
  count(options: Record<string, unknown>): Promise<number>;
  vectorSearch(embedding: number[], options: Record<string, unknown>): Promise<SearchResult[]>;
  aggregate(options: Record<string, unknown>): Promise<OpsStats>;
  getChain(since?: string): Promise<OpsEvent[]>;
  prune(options: { maxEvents?: number; maxAgeDays?: number }): Promise<{ deleted: number }>;
  getLatestHash(): Promise<string | null>;
}

class InMemoryProvider implements StorageProvider {
  readonly name = 'in-memory';
  readonly mode = 'local' as const;
  private events: OpsEvent[] = [];

  async initialize(): Promise<void> {
    // Nothing to initialize
  }

  async close(): Promise<void> {
    this.events = [];
  }

  async insert(event: OpsEvent): Promise<void> {
    this.events.push(event);
  }

  async getById(id: string): Promise<OpsEvent | null> {
    return this.events.find((e) => e.id === id) ?? null;
  }

  async query(options: { limit?: number; offset?: number }): Promise<OpsEvent[]> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return this.events
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.events.length;
  }

  async vectorSearch(): Promise<SearchResult[]> {
    // In-memory provider doesn't support vector search
    return [];
  }

  async aggregate(): Promise<OpsStats> {
    const byType = {} as Record<EventType, number>;
    const bySeverity = {} as Record<Severity, number>;
    const bySkill = {} as Record<Skill, number>;

    for (const e of this.events) {
      byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      bySkill[e.skill] = (bySkill[e.skill] ?? 0) + 1;
    }

    return {
      total_events: this.events.length,
      by_type: byType,
      by_severity: bySeverity,
      by_skill: bySkill,
      first_event: this.events[0]?.timestamp,
      last_event: this.events[this.events.length - 1]?.timestamp,
    };
  }

  async getChain(since?: string): Promise<OpsEvent[]> {
    const filtered = since
      ? this.events.filter((e) => e.timestamp >= since)
      : this.events;
    return filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async prune(options: { maxEvents?: number }): Promise<{ deleted: number }> {
    if (!options.maxEvents || this.events.length <= options.maxEvents) {
      return { deleted: 0 };
    }
    const excess = this.events.length - options.maxEvents;
    this.events = this.events
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, options.maxEvents);
    return { deleted: excess };
  }

  async getLatestHash(): Promise<string | null> {
    if (this.events.length === 0) return null;
    const sorted = this.events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return sorted[0].hash;
  }
}

// Usage with MemoryStore:
//
// import { MemoryStore } from 'agent-sentry';
//
// const store = new MemoryStore({ provider: new InMemoryProvider() });
// await store.initialize();
// await store.capture({ ... });

export { InMemoryProvider };
