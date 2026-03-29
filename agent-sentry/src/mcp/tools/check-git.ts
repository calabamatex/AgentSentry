/**
 * check-git.ts — agent_sentry_check_git tool: Inspect current git repository state.
 */

import { execFileSync } from 'child_process';
import { Logger } from '../../observability/logger';
import { errorMessage } from '../../utils/error-message';

const logger = new Logger({ module: 'mcp-check-git' });

export const name = 'agent_sentry_check_git';
export const description =
  'Check git repository status including uncommitted files, last commit age, current branch, and risk score.';

export const inputSchema = {
  type: 'object' as const,
  properties: {},
  required: [] as string[],
};

export interface CheckGitResult {
  uncommitted_files: string[];
  last_commit_age: string;
  current_branch: string;
  is_main: boolean;
  risk_score: number;
}

function execGit(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (e) {
    logger.debug('Git command failed', { error: errorMessage(e), args });
    return '';
  }
}

export async function handler(
  _args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // Get uncommitted files
    const statusOutput = execGit(['status', '--porcelain']);
    const uncommitted_files = statusOutput
      ? statusOutput.split('\n').filter((line) => line.length > 0)
      : [];

    // Get last commit age
    const last_commit_age = execGit(['log', '-1', '--format=%cr']) || 'unknown';

    // Get current branch
    const current_branch = execGit(['branch', '--show-current']) || 'unknown';

    // Calculate risk score
    let risk_score = 0;
    if (uncommitted_files.length > 0) {
      risk_score += 3;
    }
    const is_main = current_branch === 'main' || current_branch === 'master';
    if (is_main) {
      risk_score += 5;
    }

    // Check if last commit is more than 1 hour old
    const lastCommitTimestamp = execGit(['log', '-1', '--format=%ct']);
    if (lastCommitTimestamp) {
      const commitTime = parseInt(lastCommitTimestamp, 10) * 1000;
      const hourAgo = Date.now() - 3600000;
      if (commitTime < hourAgo) {
        risk_score += 2;
      }
    }

    const result: CheckGitResult = {
      uncommitted_files,
      last_commit_age,
      current_branch,
      is_main,
      risk_score,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    };
  }
}
