/**
 * capture-event.ts — agent_sentry_capture_event tool: Capture an event into MemoryStore.
 */

import { z } from 'zod';
import { MemoryStore } from '../../memory/store';
import {
  EVENT_TYPES,
  SEVERITIES,
  SKILLS,
  type EventType,
  type Severity,
  type Skill,
  type OpsEventInput,
} from '../../memory/schema';

export const name = 'agent_sentry_capture_event';
export const description =
  'Capture an operational event (decision, violation, incident, etc.) into the AgentSentry memory store.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    event_type: {
      type: 'string',
      enum: EVENT_TYPES,
      description: 'Type of event',
    },
    severity: {
      type: 'string',
      enum: SEVERITIES,
      description: 'Severity level',
    },
    skill: {
      type: 'string',
      enum: SKILLS,
      description: 'Skill that triggered or relates to this event',
    },
    title: {
      type: 'string',
      description: 'Short title for the event (max 120 chars)',
    },
    detail: {
      type: 'string',
      description: 'Detailed description of the event',
    },
    affected_files: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of affected file paths',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags for categorization',
    },
  },
  required: ['event_type', 'severity', 'skill', 'title', 'detail'],
};

export const argsSchema = z.object({
  event_type: z.enum(EVENT_TYPES as unknown as [string, ...string[]]),
  severity: z.enum(SEVERITIES as unknown as [string, ...string[]]),
  skill: z.enum(SKILLS as unknown as [string, ...string[]]),
  title: z.string(),
  detail: z.string(),
  affected_files: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let store: MemoryStore | null = null;
  try {
    const parsed = argsSchema.parse(args);

    store = new MemoryStore();
    await store.initialize();

    const eventInput: OpsEventInput = {
      timestamp: new Date().toISOString(),
      session_id: process.env.AGENT_SENTRY_SESSION_ID ?? `session-${Date.now()}`,
      agent_id: process.env.AGENT_SENTRY_AGENT_ID ?? 'mcp-server',
      event_type: parsed.event_type as EventType,
      severity: parsed.severity as Severity,
      skill: parsed.skill as Skill,
      title: parsed.title,
      detail: parsed.detail,
      affected_files: parsed.affected_files ?? [],
      tags: parsed.tags ?? [],
      metadata: {},
    };

    const event = await store.capture(eventInput);

    return {
      content: [{ type: 'text', text: JSON.stringify(event, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    };
  } finally {
    if (store) {
      await store.close().catch(() => {});
    }
  }
}
