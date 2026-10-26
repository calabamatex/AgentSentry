/**
 * risk-score.ts — agent_sentry_risk_score tool (Level 6).
 *
 * Runs context-aware risk scoring against the current session. The tool is
 * always registered, but only does work when risk scoring is active (enablement
 * Level 6); otherwise it returns a clear "enable Level 6" message. Output is
 * confidence-labeled — until a project accumulates calibration data, scores are
 * reported as `default_priors` (heuristic hints, not validated probabilities).
 */

import { z } from 'zod';
import { getSharedStore } from '../shared-store';
import { resolveConfigPath } from '../../config/resolve';
import { RiskScoringEngine, DEFAULT_RISK_SCORING_CONFIG, RiskScoringConfigSchema } from '../../risk-scoring';
import type { RiskScoringConfig } from '../../risk-scoring';
import { Logger } from '../../observability/logger';
import { safeJsonParse } from '../../utils/safe-json';
import { errorMessage } from '../../utils/error-message';

const logger = new Logger({ module: 'mcp-risk-score' });

export const name = 'agent_sentry_risk_score';

export const description =
  'Context-aware risk scoring for the current session (Level 6). Returns a ' +
  'confidence-labeled composite risk level, compound-risk findings, and a plain ' +
  'explanation. Scores are heuristic (default_priors) until the project has ' +
  'enough labeled outcomes to calibrate.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    session_id: {
      type: 'string',
      description: 'Session to score. Omit to score the most recent session.',
    },
    context_utilization: {
      type: 'number',
      description: 'Current context window utilization, 0..1 (optional live signal).',
    },
    uncommitted_files: {
      type: 'number',
      description: 'Number of uncommitted changed files (optional live signal).',
    },
    minutes_since_commit: {
      type: 'number',
      description: 'Minutes since the last commit (optional live signal).',
    },
  },
  required: [] as string[],
};

const argsSchema = z.object({
  session_id: z.string().optional(),
  context_utilization: z.number().min(0).max(1).optional(),
  uncommitted_files: z.number().min(0).optional(),
  minutes_since_commit: z.number().min(0).optional(),
});

function readConfig(): { level: number; riskConfig: RiskScoringConfig } {
  let level = 2;
  let riskConfig = DEFAULT_RISK_SCORING_CONFIG;
  try {
    const cfgPath = resolveConfigPath();
    if (cfgPath) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const raw = safeJsonParse<Record<string, unknown>>(require('fs').readFileSync(cfgPath, 'utf8'));
      const enablement = raw.enablement as { level?: number } | undefined;
      if (typeof enablement?.level === 'number') level = enablement.level;
      if (raw.risk_scoring) {
        riskConfig = RiskScoringConfigSchema.parse(raw.risk_scoring);
      }
    }
  } catch (e) {
    logger.debug('Failed to read risk_scoring config; using defaults', { error: errorMessage(e) });
  }
  return { level, riskConfig };
}

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const parsed = argsSchema.parse(args);
    const { level, riskConfig } = readConfig();

    // Gate: risk scoring is a Level 6 capability.
    if (level < 6) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Risk scoring is inactive. It is a Level 6 capability — run ' +
              '`agent-sentry enable --level 6` to activate context-aware risk scoring.',
          },
        ],
      };
    }

    const store = await getSharedStore();

    // Resolve the target session: explicit, or the most recent one.
    let sessionId = parsed.session_id;
    if (!sessionId) {
      const recent = await store.list({ limit: 1 });
      sessionId = recent[0]?.session_id;
    }
    if (!sessionId) {
      return {
        content: [{ type: 'text', text: 'No session events found to score.' }],
      };
    }

    const events = await store.list({ session_id: sessionId, limit: 1000 });
    // store.list returns newest-first; feed oldest-first into the engine.
    const ordered = [...events].reverse();

    const engine = new RiskScoringEngine(riskConfig, sessionId);
    engine.loadFromEvents(ordered);
    engine.applySignals({
      context_utilization: parsed.context_utilization,
      uncommitted_files: parsed.uncommitted_files,
      minutes_since_commit: parsed.minutes_since_commit,
    });

    const score = engine.evaluate(new Date().toISOString());

    return {
      content: [{ type: 'text', text: JSON.stringify({ session_id: sessionId, ...score }, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error scoring risk: ${errorMessage(error)}` }],
    };
  }
}
