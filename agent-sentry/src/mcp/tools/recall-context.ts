/**
 * recall-context.ts — MCP tool: recall relevant prior context for a task.
 *
 * Searches across session summaries, patterns, and events in MemoryStore
 * to surface relevant prior work context.
 */

import { z } from 'zod';
import { ContextRecaller } from '../../memory/intelligence';
import { getSharedStore } from '../shared-store';

export const name = 'agent_sentry_recall_context';

export const description =
  'Search memory for relevant prior session context given a task description. ' +
  'Returns matching sessions, summaries, and related events.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description: 'Task description or search query to find relevant prior context',
    },
    max_results: {
      type: 'number',
      description: 'Maximum number of session results to return (default: 5)',
    },
    lookback_days: {
      type: 'number',
      description: 'How many days back to search (default: 90)',
    },
  },
  required: ['query'] as string[],
};

export const argsSchema = z.object({
  query: z.string(),
  max_results: z.number().optional(),
  lookback_days: z.number().optional(),
});

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const parsed = argsSchema.parse(args);

    const store = await getSharedStore();
    const recaller = new ContextRecaller(store);

    const maxResults = parsed.max_results ?? 5;
    const lookbackDays = parsed.lookback_days ?? 90;
    const result = await recaller.recall(parsed.query, { maxResults, lookbackDays });

    if (result.results.length === 0) {
      return {
        content: [{ type: 'text', text: `No relevant prior context found for: "${parsed.query}"` }],
      };
    }

    const sections: string[] = [`Found ${result.results.length} relevant session(s) for: "${parsed.query}"\n`];

    for (const r of result.results) {
      sections.push(`--- Session: ${r.session_id} (relevance: ${r.relevance_score.toFixed(2)}) ---`);
      if (r.summary) {
        sections.push(`Summary: ${r.summary}`);
      }
      if (r.relevant_events.length > 0) {
        sections.push('Key events:');
        for (const e of r.relevant_events) {
          sections.push(`  [${e.event_type}/${e.severity}] ${e.title}: ${e.detail.slice(0, 200)}`);
        }
      }
      sections.push('');
    }

    return {
      content: [{ type: 'text', text: sections.join('\n') }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error recalling context: ${message}` }],
    };
  }
}
