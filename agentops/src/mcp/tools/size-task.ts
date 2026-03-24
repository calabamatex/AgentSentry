/**
 * size-task.ts — agent_sentry_size_task tool: Analyze task complexity and risk.
 */

import { z } from 'zod';

export const name = 'agent_sentry_size_task';
export const description =
  'Analyze task complexity based on description and affected files. Returns risk level and contributing factors.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    task: {
      type: 'string',
      description: 'Description of the task to size',
    },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of files likely affected by the task',
    },
  },
  required: ['task'],
};

export const argsSchema = z.object({
  task: z.string(),
  files: z.array(z.string()).optional(),
});

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface SizeTaskFactor {
  name: string;
  contribution: number;
}

export interface SizeTaskResult {
  risk_level: RiskLevel;
  estimated_files: number;
  factors: SizeTaskFactor[];
  recommendation: string;
}

const HIGH_RISK_KEYWORDS: Array<{ keyword: RegExp; weight: number; name: string }> = [
  { keyword: /migrat/i, weight: 3, name: 'migration' },
  { keyword: /refactor/i, weight: 2, name: 'refactoring' },
  { keyword: /security|auth|encrypt|credential/i, weight: 3, name: 'security' },
  { keyword: /delet|remov|drop/i, weight: 2, name: 'destructive-operation' },
  { keyword: /databas|schema|sql/i, weight: 2, name: 'database-change' },
  { keyword: /deploy|production|release/i, weight: 2, name: 'deployment' },
  { keyword: /api|endpoint|route/i, weight: 1, name: 'api-change' },
  { keyword: /test|spec/i, weight: -1, name: 'testing' },
  { keyword: /config|setting/i, weight: 1, name: 'configuration' },
  { keyword: /critical|urgent|hotfix/i, weight: 2, name: 'urgency' },
];

function calculateRiskLevel(score: number): RiskLevel {
  if (score <= 2) return 'LOW';
  if (score <= 5) return 'MEDIUM';
  if (score <= 8) return 'HIGH';
  return 'CRITICAL';
}

function generateRecommendation(riskLevel: RiskLevel, factors: SizeTaskFactor[]): string {
  const topFactors = factors
    .filter((f) => f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((f) => f.name);

  switch (riskLevel) {
    case 'LOW':
      return 'Low risk task. Proceed with standard development workflow.';
    case 'MEDIUM':
      return `Medium risk. Key factors: ${topFactors.join(', ')}. Consider code review before merging.`;
    case 'HIGH':
      return `High risk. Key factors: ${topFactors.join(', ')}. Recommend thorough testing, code review, and staged rollout.`;
    case 'CRITICAL':
      return `Critical risk. Key factors: ${topFactors.join(', ')}. Require senior review, comprehensive testing, and rollback plan.`;
  }
}

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const parsed = argsSchema.parse(args);
    const factors: SizeTaskFactor[] = [];
    let totalScore = 0;

    // File count factor
    const estimatedFiles = parsed.files?.length ?? estimateFileCount(parsed.task);
    const fileScore = Math.min(3, Math.floor(estimatedFiles / 3));
    factors.push({ name: 'file-count', contribution: fileScore });
    totalScore += fileScore;

    // Keyword analysis
    for (const { keyword, weight, name } of HIGH_RISK_KEYWORDS) {
      if (keyword.test(parsed.task)) {
        factors.push({ name, contribution: weight });
        totalScore += weight;
      }
    }

    // Task length as complexity proxy
    const wordCount = parsed.task.split(/\s+/).length;
    if (wordCount > 50) {
      const complexityScore = Math.min(2, Math.floor(wordCount / 50));
      factors.push({ name: 'task-complexity', contribution: complexityScore });
      totalScore += complexityScore;
    }

    totalScore = Math.max(0, totalScore);
    const risk_level = calculateRiskLevel(totalScore);
    const recommendation = generateRecommendation(risk_level, factors);

    const result: SizeTaskResult = {
      risk_level,
      estimated_files: estimatedFiles,
      factors: factors.filter((f) => f.contribution !== 0),
      recommendation,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    };
  }
}

function estimateFileCount(task: string): number {
  const wordCount = task.split(/\s+/).length;
  if (wordCount < 10) return 1;
  if (wordCount < 30) return 3;
  if (wordCount < 60) return 5;
  return 8;
}
