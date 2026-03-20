/**
 * context-estimation.ts — Estimates context window usage and health.
 * Used by Skills 2 (context_health) and 4 (small_bets).
 */

export interface ContextHealth {
  estimatedTokens: number;
  percentUsed: number;
  messageCount: number;
  recommendation: 'continue' | 'caution' | 'refresh';
  details: string;
}

const DEFAULT_MAX_TOKENS = 200_000;
const TOKENS_PER_MESSAGE = 4_000;

/**
 * Estimates context window usage based on message count.
 * Uses ~4000 tokens per message as a heuristic.
 *
 * Thresholds:
 * - continue: <60% used
 * - caution: 60-80% used
 * - refresh: >80% used
 */
export function estimateContext(
  messageCount: number,
  maxTokens?: number
): ContextHealth {
  const max = maxTokens ?? DEFAULT_MAX_TOKENS;
  const estimatedTokens = messageCount * TOKENS_PER_MESSAGE;
  const percentUsed = Math.min(100, (estimatedTokens / max) * 100);

  let recommendation: 'continue' | 'caution' | 'refresh';
  let details: string;

  if (percentUsed < 60) {
    recommendation = 'continue';
    details = `Context healthy at ${percentUsed.toFixed(1)}% usage. ${Math.floor((max - estimatedTokens) / TOKENS_PER_MESSAGE)} messages remaining.`;
  } else if (percentUsed <= 80) {
    recommendation = 'caution';
    details = `Context at ${percentUsed.toFixed(1)}% usage. Consider summarizing or checkpointing soon. ~${Math.floor((max - estimatedTokens) / TOKENS_PER_MESSAGE)} messages remaining.`;
  } else {
    recommendation = 'refresh';
    details = `Context at ${percentUsed.toFixed(1)}% usage. Recommend refreshing context immediately. ~${Math.max(0, Math.floor((max - estimatedTokens) / TOKENS_PER_MESSAGE))} messages remaining.`;
  }

  return {
    estimatedTokens,
    percentUsed: Math.round(percentUsed * 10) / 10,
    messageCount,
    recommendation,
    details,
  };
}
