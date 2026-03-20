/**
 * health.ts — agentops_health tool: Check system health and stats.
 */

import { MemoryStore } from '../../memory/store';

export const name = 'agentops_health';
export const description =
  'Check AgentOps system health including event statistics, store status, and chain integrity.';

export const inputSchema = {
  type: 'object' as const,
  properties: {},
  required: [] as string[],
};

export interface HealthResult {
  status: 'healthy' | 'degraded' | 'error';
  total_events: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  by_skill: Record<string, number>;
  first_event?: string;
  last_event?: string;
}

export async function handler(
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let store: MemoryStore | null = null;
  try {
    store = new MemoryStore();
    await store.initialize();

    const stats = await store.stats();

    let status: 'healthy' | 'degraded' | 'error' = 'healthy';

    // Check for degraded conditions
    const criticalCount = stats.by_severity?.critical ?? 0;
    if (criticalCount > 10) {
      status = 'degraded';
    }

    const result: HealthResult = {
      status,
      total_events: stats.total_events,
      by_type: stats.by_type,
      by_severity: stats.by_severity,
      by_skill: stats.by_skill,
      first_event: stats.first_event,
      last_event: stats.last_event,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorResult: HealthResult = {
      status: 'error',
      total_events: 0,
      by_type: {},
      by_severity: {},
      by_skill: {},
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ...errorResult, error: message }, null, 2),
        },
      ],
    };
  } finally {
    if (store) {
      await store.close().catch(() => {});
    }
  }
}
