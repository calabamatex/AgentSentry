/**
 * event-capture.ts — Captures operational events to the MemoryStore.
 * Used by all skills.
 */

import { MemoryStore } from '../memory/store';
import type { OpsEvent, EventType, Severity, Skill, OpsEventInput } from '../memory/schema';

export interface CaptureParams {
  eventType: EventType;
  severity: Severity;
  skill: Skill;
  title: string;
  detail: string;
  affectedFiles?: string[];
  tags?: string[];
  sessionId?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Captures an operational event to the MemoryStore.
 * Creates a new MemoryStore instance, initializes it, captures the event, then closes.
 *
 * @param params - Event parameters
 * @returns The captured OpsEvent with computed hash and chain link
 */
export async function captureEvent(params: CaptureParams): Promise<OpsEvent> {
  const store = new MemoryStore();

  try {
    await store.initialize();

    const input: OpsEventInput = {
      timestamp: new Date().toISOString(),
      session_id: params.sessionId ?? `session-${Date.now()}`,
      agent_id: params.agentId ?? 'agent-sentry-primitives',
      event_type: params.eventType,
      severity: params.severity,
      skill: params.skill,
      title: params.title,
      detail: params.detail,
      affected_files: params.affectedFiles ?? [],
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
    };

    const event = await store.capture(input);
    return event;
  } finally {
    await store.close();
  }
}
