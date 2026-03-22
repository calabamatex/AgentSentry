/**
 * health.ts — agentops_health tool: comprehensive system health check.
 */

import { MemoryStore } from '../../memory/store';
import { loadMemoryConfig } from '../../memory/providers/provider-factory';
import { detectEmbeddingProvider } from '../../memory/embeddings';
import { getActiveSkills, generateConfigForLevel, LEVEL_NAMES } from '../../enablement/engine';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'mcp-health' });

export const name = 'agentops_health';
export const description =
  'Returns comprehensive system health: event stats, provider status, chain integrity, embedding state, enablement level.';

export const inputSchema = {
  type: 'object' as const,
  properties: {},
  required: [] as string[],
};

export interface HealthResult {
  status: 'healthy' | 'degraded' | 'error';
  store: {
    provider: string;
    total_events: number;
    by_type: Record<string, number>;
    by_severity: Record<string, number>;
    by_skill: Record<string, number>;
    first_event?: string;
    last_event?: string;
  };
  chain: {
    verified: boolean;
    total_checked: number;
    broken_at?: string;
  };
  embedding: {
    provider: string;
    dimension: number;
    available: boolean;
  };
  enablement: {
    level: number;
    name: string;
    active_skills: string[];
  };
  config: {
    max_events: number;
    auto_prune_days: number;
    database_path: string;
  };
  issues: string[];
}

export async function handler(
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  let store: MemoryStore | null = null;
  const issues: string[] = [];
  let overallStatus: 'healthy' | 'degraded' | 'error' = 'healthy';

  try {
    // Load config
    const memConfig = loadMemoryConfig();

    // Initialize store
    store = new MemoryStore();
    await store.initialize();

    // Get stats
    const stats = await store.stats();

    // Check chain integrity
    let chainResult = { verified: true, total_checked: 0, broken_at: undefined as string | undefined };
    try {
      const chain = await store.verifyChain();
      chainResult = {
        verified: chain.valid,
        total_checked: chain.total_checked,
        broken_at: chain.first_broken_at,
      };
      if (!chain.valid) {
        issues.push(`Hash chain broken at ${chain.first_broken_at}`);
        overallStatus = 'degraded';
      }
    } catch (err) {
      issues.push(`Chain verification failed: ${err instanceof Error ? err.message : String(err)}`);
      overallStatus = 'degraded';
    }

    // Check embedding provider
    let embeddingInfo = { provider: 'noop', dimension: 0, available: false };
    try {
      const embProvider = await detectEmbeddingProvider();
      embeddingInfo = {
        provider: embProvider.name,
        dimension: embProvider.dimension,
        available: embProvider.dimension > 0,
      };
      if (!embeddingInfo.available) {
        issues.push('No embedding provider available — semantic search disabled, using text-only fallback');
      }
    } catch (e) {
      logger.warn('Embedding provider detection failed', { error: e instanceof Error ? e.message : String(e) });
      issues.push('Embedding provider detection failed');
    }

    // Check enablement
    let enablementLevel = 3; // default
    try {
      const fsModule = await import('fs');
      const pathModule = await import('path');
      const cfgPath = pathModule.resolve('agentops/agentops.config.json');
      const raw = JSON.parse(fsModule.readFileSync(cfgPath, 'utf8'));
      if (raw.enablement?.level && typeof raw.enablement.level === 'number') {
        enablementLevel = raw.enablement.level;
      }
    } catch (e) {
      logger.debug('Failed to read enablement level from config', { error: e instanceof Error ? e.message : String(e) });
    }
    const enablementConfig = generateConfigForLevel(enablementLevel);
    const enablementInfo = {
      level: enablementLevel,
      name: LEVEL_NAMES[enablementLevel] || `Level ${enablementLevel}`,
      active_skills: getActiveSkills(enablementConfig),
    };

    // Check for degraded conditions
    const criticalCount = stats.by_severity?.critical ?? 0;
    if (criticalCount > 10) {
      issues.push(`${criticalCount} critical events recorded`);
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    const result: HealthResult = {
      status: overallStatus,
      store: {
        provider: memConfig.provider,
        total_events: stats.total_events,
        by_type: stats.by_type,
        by_severity: stats.by_severity,
        by_skill: stats.by_skill,
        first_event: stats.first_event,
        last_event: stats.last_event,
      },
      chain: chainResult,
      embedding: embeddingInfo,
      enablement: enablementInfo,
      config: {
        max_events: memConfig.max_events,
        auto_prune_days: memConfig.auto_prune_days,
        database_path: memConfig.database_path,
      },
      issues,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          store: { provider: 'unknown', total_events: 0, by_type: {}, by_severity: {}, by_skill: {} },
          chain: { verified: false, total_checked: 0 },
          embedding: { provider: 'unknown', dimension: 0, available: false },
          enablement: { level: 0, name: 'unknown', active_skills: [] },
          config: { max_events: 0, auto_prune_days: 0, database_path: '' },
          issues: [`Store initialization failed: ${message}`],
        }, null, 2),
      }],
    };
  } finally {
    if (store) {
      await store.close().catch(() => {});
    }
  }
}
