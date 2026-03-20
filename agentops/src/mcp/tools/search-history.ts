/**
 * search-history.ts — agentops_search_history tool: Search event history.
 */

import { z } from 'zod';
import { MemoryStore } from '../../memory/store';
import { EVENT_TYPES, SEVERITIES, type EventType, type Severity } from '../../memory/schema';

export const name = 'agentops_search_history';
export const description =
  'Search the AgentOps event history using text queries with optional filters.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: 'Search query text',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return (default: 10)',
    },
    event_type: {
      type: 'string',
      enum: EVENT_TYPES,
      description: 'Filter by event type',
    },
    severity: {
      type: 'string',
      enum: SEVERITIES,
      description: 'Filter by severity',
    },
    since: {
      type: 'string',
      description: 'Filter events after this ISO timestamp',
    },
  },
  required: ['query'],
};

export const argsSchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
  event_type: z.enum(EVENT_TYPES as unknown as [string, ...string[]]).optional(),
  severity: z.enum(SEVERITIES as unknown as [string, ...string[]]).optional(),
  since: z.string().optional(),
});

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let store: MemoryStore | null = null;
  try {
    const parsed = argsSchema.parse(args);

    store = new MemoryStore();
    await store.initialize();

    const results = await store.search(parsed.query, {
      limit: parsed.limit ?? 10,
      event_type: parsed.event_type as EventType | undefined,
      severity: parsed.severity as Severity | undefined,
      since: parsed.since,
    });

    const output = {
      results: results.map((r) => ({
        event: r.event,
        score: r.score,
      })),
      total: results.length,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
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
