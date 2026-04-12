#!/usr/bin/env node
/**
 * cost-tracker.ts — TypeScript implementation of the PostToolUse cost tracking hook.
 *
 * Replaces the bash cost-tracker.sh with a portable, testable TypeScript implementation.
 * Estimates cost per API call, tracks cumulative session/monthly spend,
 * warns at budget thresholds, and logs cost events as NDJSON.
 *
 * Always exits 0 (advisory only, never blocks).
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveConfigPath, isGloballyEnabled } from '../../config/resolve';
import { Logger } from '../../observability/logger';
import { errorMessage } from '../../utils/error-message';
import { safeJsonParse } from '../../utils/safe-json';
import { atomicWriteSync, safeReadSync } from '../../utils/safe-io';

const logger = new Logger({ module: 'hook-cost-tracker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HookInput {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

interface CostState {
  session_total: string;
  session_calls: string;
  session_start: string;
  last_model: string;
  last_update: string;
}

interface BudgetConfig {
  session_budget: number;
  monthly_budget: number;
  warn_threshold: number;
}

// ---------------------------------------------------------------------------
// Model pricing (per token)
// ---------------------------------------------------------------------------

type ModelTier = 'haiku' | 'sonnet' | 'opus';

const TIER_COST: Record<ModelTier, number> = {
  haiku: 0.0002,
  sonnet: 0.003,
  opus: 0.015,
};

const TIER_RATES: Record<ModelTier, { in: number; out: number }> = {
  haiku: { in: 0.00000025, out: 0.00000125 },
  sonnet: { in: 0.000003, out: 0.000015 },
  opus: { in: 0.000015, out: 0.000075 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectModelTier(hint: string): ModelTier {
  const lower = hint.toLowerCase();
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('opus')) return 'opus';
  return 'sonnet';
}

function loadBudgetConfig(): BudgetConfig {
  const defaults: BudgetConfig = { session_budget: 10, monthly_budget: 500, warn_threshold: 0.80 };
  const cfgPath = resolveConfigPath();
  if (!cfgPath) return defaults;

  try {
    const raw = safeJsonParse<{ budget?: Partial<BudgetConfig> } & Partial<BudgetConfig>>(
      safeReadSync(cfgPath).toString('utf-8'),
    );
    return {
      session_budget: raw.budget?.session_budget ?? raw.session_budget ?? defaults.session_budget,
      monthly_budget: raw.budget?.monthly_budget ?? raw.monthly_budget ?? defaults.monthly_budget,
      warn_threshold: raw.budget?.warn_threshold ?? raw.warn_threshold ?? defaults.warn_threshold,
    };
  } catch {
    logger.debug('Could not parse cost config, using defaults');
    return defaults;
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runCostTracker(hookInput: HookInput): Promise<void> {
  const tmpBase = path.join(process.env.TMPDIR ?? '/tmp', 'agent-sentry');
  const scriptDir = path.resolve(__dirname, '..', '..', '..');
  const dashboardData = path.join(scriptDir, 'dashboard', 'data');
  const costLog = path.join(dashboardData, 'cost-log.json');
  const costState = path.join(tmpBase, 'cost-state');

  ensureDir(tmpBase);
  ensureDir(dashboardData);

  const budget = loadBudgetConfig();

  // Detect model tier
  const modelHint = hookInput.model ?? process.env.CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL ?? '';
  const modelTier = detectModelTier(modelHint);

  // Calculate cost
  const inputTokens = hookInput.input_tokens ?? 0;
  const outputTokens = hookInput.output_tokens ?? 0;
  let callCost: number;

  if (inputTokens > 0 || outputTokens > 0) {
    const rates = TIER_RATES[modelTier];
    callCost = inputTokens * rates.in + outputTokens * rates.out;
  } else {
    callCost = TIER_COST[modelTier];
  }

  // Load session state
  let sessionTotal = 0;
  let sessionCalls = 0;
  let sessionStart = new Date().toISOString();

  if (fs.existsSync(costState)) {
    try {
      const state = safeJsonParse<CostState>(safeReadSync(costState).toString('utf-8'));
      sessionTotal = parseFloat(state.session_total) || 0;
      sessionCalls = parseInt(state.session_calls, 10) || 0;
      sessionStart = state.session_start || sessionStart;
    } catch {
      logger.debug('Corrupted cost state — starting fresh');
    }
  }

  // Update totals
  const newTotal = sessionTotal + callCost;
  const newCalls = sessionCalls + 1;
  const timestamp = new Date().toISOString();

  // Write state
  const stateObj: CostState = {
    session_total: newTotal.toFixed(6),
    session_calls: String(newCalls),
    session_start: sessionStart,
    last_model: modelTier,
    last_update: timestamp,
  };
  atomicWriteSync(costState, JSON.stringify(stateObj));

  // Budget checks
  const budgetPct = (newTotal / budget.session_budget) * 100;

  if (newTotal >= budget.session_budget) {
    logger.warn('Session budget exceeded', { total: newTotal, budget: budget.session_budget });
  } else if (newTotal >= budget.session_budget * budget.warn_threshold) {
    logger.warn('Approaching session budget', { total: newTotal, budget: budget.session_budget, pct: budgetPct });
  }

  // Monthly tracking
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  const monthlyFile = path.join(tmpBase, `cost-monthly-${monthKey}`);
  let monthlyTotal = 0;

  if (fs.existsSync(monthlyFile)) {
    try {
      monthlyTotal = parseFloat(safeReadSync(monthlyFile).toString('utf-8').trim()) || 0;
    } catch {
      logger.debug('Could not read monthly total — starting fresh');
    }
  }

  const newMonthly = monthlyTotal + callCost;
  atomicWriteSync(monthlyFile, newMonthly.toFixed(6));

  const monthlyPct = (newMonthly / budget.monthly_budget) * 100;
  if (newMonthly >= budget.monthly_budget) {
    logger.warn('Monthly budget exceeded', { total: newMonthly, budget: budget.monthly_budget });
  } else if (newMonthly >= budget.monthly_budget * budget.warn_threshold) {
    logger.warn('Approaching monthly budget', { total: newMonthly, budget: budget.monthly_budget, pct: monthlyPct });
  }

  // Append NDJSON log
  const logEntry = JSON.stringify({
    timestamp,
    type: 'cost',
    model_tier: modelTier,
    call_cost: callCost.toFixed(6),
    session_total: newTotal.toFixed(6),
    session_calls: newCalls,
    budget_status: newTotal >= budget.session_budget ? 'exceeded' : newTotal >= budget.session_budget * budget.warn_threshold ? 'warning' : 'ok',
    budget_pct: budgetPct.toFixed(1),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    monthly_total: newMonthly.toFixed(6),
  });
  fs.appendFileSync(costLog, logEntry + '\n', 'utf-8');

  // Log rotation: cap at 5000 lines
  try {
    const content = safeReadSync(costLog).toString('utf-8');
    const lines = content.trimEnd().split('\n');
    if (lines.length > 5000) {
      const kept = lines.slice(-2500);
      atomicWriteSync(costLog, kept.join('\n') + '\n');
    }
  } catch {
    logger.debug('Non-fatal error during cost log rotation');
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!isGloballyEnabled()) {
    process.exit(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');

  let hookInput: HookInput = {};
  if (raw.trim()) {
    try {
      hookInput = safeJsonParse<HookInput>(raw);
    } catch {
      logger.debug('Could not parse hook input');
    }
  }

  await runCostTracker(hookInput);
}

main().catch((e) => {
  logger.debug('Cost tracker error', { error: errorMessage(e) });
}).finally(() => {
  process.exit(0);
});
