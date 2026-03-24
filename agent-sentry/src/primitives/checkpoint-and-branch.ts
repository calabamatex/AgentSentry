/**
 * checkpoint-and-branch.ts — Git checkpoint and branch primitives.
 * Used by Skills 1 (save_points) and 4 (small_bets).
 */

import { execFileSync } from 'child_process';

export interface CheckpointResult {
  success: boolean;
  commitHash?: string;
  branch?: string;
  message: string;
}

/**
 * Creates a git checkpoint by staging files and committing.
 * @param message - Commit message
 * @param files - Specific files to stage, or undefined for all (-A)
 */
export async function createCheckpoint(
  message: string,
  files?: string[]
): Promise<CheckpointResult> {
  try {
    if (files && files.length > 0) {
      execFileSync('git', ['add', ...files], { encoding: 'utf-8', stdio: 'pipe' });
    } else {
      execFileSync('git', ['add', '-A'], { encoding: 'utf-8', stdio: 'pipe' });
    }

    execFileSync('git', ['commit', '-m', message], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const commitHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    return {
      success: true,
      commitHash,
      message: `Checkpoint created: ${commitHash.substring(0, 7)}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Checkpoint failed: ${errMsg}`,
    };
  }
}

/**
 * Creates a new git branch for safe experimentation.
 * @param name - Branch name to create
 */
export async function createSafetyBranch(
  name: string
): Promise<CheckpointResult> {
  try {
    execFileSync('git', ['checkout', '-b', name], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    return {
      success: true,
      branch: name,
      message: `Safety branch created: ${name}`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Branch creation failed: ${errMsg}`,
    };
  }
}

/**
 * Returns the name of the current git branch.
 */
export async function getCurrentBranch(): Promise<string> {
  return execFileSync('git', ['branch', '--show-current'], {
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim();
}
