/**
 * risk-scoring.ts — Computes a risk score for proposed changes.
 * Used by Skills 4 (small_bets) and 5 (proactive_safety).
 */

export interface RiskFactor {
  name: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface RiskAssessment {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: RiskFactor[];
  recommendation: string;
}

function scoreToLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score <= 3) return 'LOW';
  if (score <= 7) return 'MEDIUM';
  if (score <= 11) return 'HIGH';
  return 'CRITICAL';
}

function levelToRecommendation(level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): string {
  switch (level) {
    case 'LOW':
      return 'Proceed with standard workflow.';
    case 'MEDIUM':
      return 'Create a checkpoint before proceeding. Review changes carefully.';
    case 'HIGH':
      return 'Create a safety branch. Get review before merging. Run full test suite.';
    case 'CRITICAL':
      return 'STOP. Create safety branch immediately. Requires senior review and full test suite before any merge.';
  }
}

/**
 * Assesses risk based on change characteristics.
 *
 * Scoring:
 * - file_count: weight 2, value = min(fileCount, 5), contribution = value * weight / 5
 *   (normalized so max contribution from files is weight=2)
 * - db_changes: weight 3, value = 3 if true else 0
 * - shared_code: weight 2, value = 2 if true else 0
 * - main_branch: weight 5, value = 5 if true else 0
 *
 * Levels: 0-3 LOW, 4-7 MEDIUM, 8-11 HIGH, 12-15 CRITICAL
 */
export function assessRisk(params: {
  files: string[];
  hasDatabaseChanges: boolean;
  touchesSharedCode: boolean;
  isMainBranch: boolean;
}): RiskAssessment {
  const fileCount = Math.min(params.files.length, 5);
  const fileContribution = Math.round((fileCount * 2) / 5);

  const dbValue = params.hasDatabaseChanges ? 3 : 0;
  const sharedValue = params.touchesSharedCode ? 2 : 0;
  const mainValue = params.isMainBranch ? 5 : 0;

  const factors: RiskFactor[] = [
    {
      name: 'file_count',
      value: fileCount,
      weight: 2,
      contribution: fileContribution,
    },
    {
      name: 'db_changes',
      value: dbValue,
      weight: 3,
      contribution: dbValue,
    },
    {
      name: 'shared_code',
      value: sharedValue,
      weight: 2,
      contribution: sharedValue,
    },
    {
      name: 'main_branch',
      value: mainValue,
      weight: 5,
      contribution: mainValue,
    },
  ];

  const score = Math.min(
    15,
    factors.reduce((sum, f) => sum + f.contribution, 0)
  );
  const level = scoreToLevel(score);
  const recommendation = levelToRecommendation(level);

  return { score, level, factors, recommendation };
}
