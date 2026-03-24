/**
 * event-subscriber.ts — Subscribes to event-bus.ts, captures events to MemoryStore.
 * Does NOT modify event-bus.ts — only imports and subscribes.
 */

import { subscribe, EventType as BusEventType, EventPayload } from '../../core/event-bus';
import { MemoryStore } from './store';
import { EventType, Severity, Skill } from './schema';

const BUS_TO_OPS_TYPE: Record<string, EventType> = {
  [BusEventType.OnAuditLog]: 'audit_finding',
  [BusEventType.OnError]: 'incident',
  [BusEventType.OnMetric]: 'pattern',
  [BusEventType.PreToolUse]: 'decision',
  [BusEventType.PostToolUse]: 'decision',
  [BusEventType.PreSession]: 'decision',
  [BusEventType.PostSession]: 'handoff',
  [BusEventType.PrePlan]: 'decision',
  [BusEventType.PostPlan]: 'decision',
  [BusEventType.PluginLoaded]: 'decision',
  [BusEventType.PluginUnloaded]: 'decision',
};

function mapSeverity(data: Record<string, unknown>): Severity {
  const sev = data.severity as string | undefined;
  if (sev && ['low', 'medium', 'high', 'critical'].includes(sev)) {
    return sev as Severity;
  }
  return 'low';
}

function mapSkill(data: Record<string, unknown>): Skill {
  const skill = data.skill as string | undefined;
  if (skill && ['save_points', 'context_health', 'standing_orders', 'small_bets', 'proactive_safety', 'system'].includes(skill)) {
    return skill as Skill;
  }
  return 'system';
}

export function registerEventSubscriber(store: MemoryStore, sessionId: string): void {
  const handler = async (payload: EventPayload) => {
    const eventType = BUS_TO_OPS_TYPE[payload.type] ?? 'decision';
    const title = (payload.data.title as string) ?? `${payload.type} event`;
    const detail = (payload.data.detail as string) ?? JSON.stringify(payload.data);

    try {
      await store.capture({
        timestamp: payload.timestamp,
        session_id: sessionId,
        agent_id: (payload.data.agent_id as string) ?? 'system',
        event_type: eventType,
        severity: mapSeverity(payload.data),
        skill: mapSkill(payload.data),
        title: title.slice(0, 120),
        detail,
        affected_files: (payload.data.affected_files as string[]) ?? [],
        tags: (payload.data.tags as string[]) ?? [payload.type],
        metadata: payload.data,
      });
    } catch (err) {
      console.error('[AgentSentry] Memory capture failed:', err);
    }
  };

  // Subscribe to all event types
  for (const busType of Object.values(BusEventType)) {
    subscribe(busType, handler);
  }
}
