/**
 * scaffold-update.ts — Checks project scaffold file presence and health.
 * Used by Skills 2 (context_health) and 3 (standing_orders).
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

export interface ScaffoldFile {
  path: string;
  exists: boolean;
  issues: string[];
}

export interface ScaffoldResult {
  files: ScaffoldFile[];
  allPresent: boolean;
  missingCount: number;
}

const SCAFFOLD_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'PLANNING.md',
  'TASKS.md',
  'CONTEXT.md',
  'WORKFLOW.md',
];

const MIN_CONTENT_LENGTH = 20;

function validateFileContent(filePath: string): string[] {
  const issues: string[] = [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (content.trim().length === 0) {
      issues.push('File is empty');
    } else if (content.trim().length < MIN_CONTENT_LENGTH) {
      issues.push('File has minimal content (less than 20 characters)');
    }
    if (!content.includes('#')) {
      issues.push('File has no markdown headings');
    }
  } catch {
    issues.push('File could not be read');
  }
  return issues;
}

/**
 * Checks for the presence and basic validity of standard project scaffold files.
 * @param projectRoot - Root directory to check (defaults to cwd)
 */
export async function updateScaffold(projectRoot?: string): Promise<ScaffoldResult> {
  const root = projectRoot ? resolve(projectRoot) : process.cwd();
  const files: ScaffoldFile[] = [];
  let missingCount = 0;

  for (const fileName of SCAFFOLD_FILES) {
    const fullPath = join(root, fileName);
    const exists = existsSync(fullPath);

    if (!exists) {
      missingCount++;
      files.push({
        path: fileName,
        exists: false,
        issues: ['File does not exist'],
      });
    } else {
      const issues = validateFileContent(fullPath);
      files.push({
        path: fileName,
        exists: true,
        issues,
      });
    }
  }

  return {
    files,
    allPresent: missingCount === 0,
    missingCount,
  };
}
