/**
 * rules-validation.ts — Validates changes against project rules.
 * Used by Skills 3 (standing_orders) and 5 (proactive_safety).
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'rules-validation' });

export interface RuleViolation {
  rule: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  file?: string;
  line?: number;
}

export interface ValidationResult {
  violations: RuleViolation[];
  compliant: boolean;
  rulesChecked: number;
}

interface ParsedRule {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  check: (filePath: string, changeDescription: string) => RuleViolation | null;
}

const DEFAULT_RULES_FILES = ['CLAUDE.md', 'AGENTS.md'];

function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  while (dir !== '/') {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, 'CLAUDE.md'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return resolve(startDir);
}

function loadRulesContent(rulesFiles: string[], projectRoot: string): string {
  let content = '';
  for (const file of rulesFiles) {
    const fullPath = join(projectRoot, file);
    if (existsSync(fullPath)) {
      content += readFileSync(fullPath, 'utf-8') + '\n';
    }
  }
  return content;
}

function buildRules(rulesContent: string): ParsedRule[] {
  const rules: ParsedRule[] = [];

  // File organization rules
  if (rulesContent.includes('NEVER save') && rulesContent.includes('root folder')) {
    rules.push({
      id: 'file-org-no-root',
      description: 'Never save working files to root folder',
      severity: 'high',
      check: (filePath) => {
        const parts = filePath.split('/').filter(Boolean);
        const ext = filePath.split('.').pop()?.toLowerCase();
        const dangerousExts = ['ts', 'js', 'md', 'txt', 'json'];
        if (parts.length === 1 && ext && dangerousExts.includes(ext)) {
          return {
            rule: 'file-org-no-root',
            description: 'File saved to root folder violates file organization rules',
            severity: 'high',
            file: filePath,
          };
        }
        return null;
      },
    });
  }

  // Security: no hardcoded secrets
  if (rulesContent.includes('NEVER hardcode') || rulesContent.includes('secrets')) {
    rules.push({
      id: 'security-no-secrets',
      description: 'Never hardcode API keys, secrets, or credentials',
      severity: 'critical',
      check: (filePath) => {
        const lowerPath = filePath.toLowerCase();
        if (lowerPath.endsWith('.env') || lowerPath.includes('credentials')) {
          return {
            rule: 'security-no-secrets',
            description: 'File may contain secrets or credentials',
            severity: 'critical',
            file: filePath,
          };
        }
        return null;
      },
    });
  }

  // Testing rules
  if (rulesContent.includes('run tests') || rulesContent.includes('ALWAYS run tests')) {
    rules.push({
      id: 'testing-required',
      description: 'Tests must be run after code changes',
      severity: 'medium',
      check: (_filePath, changeDescription) => {
        const lower = changeDescription.toLowerCase();
        if (
          (lower.includes('code') || lower.includes('function') || lower.includes('class')) &&
          !lower.includes('test')
        ) {
          return {
            rule: 'testing-required',
            description: 'Code changes detected without mention of testing',
            severity: 'medium',
          };
        }
        return null;
      },
    });
  }

  // Build verification
  if (rulesContent.includes('verify build') || rulesContent.includes('build succeeds')) {
    rules.push({
      id: 'build-verification',
      description: 'Build must succeed before committing',
      severity: 'medium',
      check: (_filePath, changeDescription) => {
        const lower = changeDescription.toLowerCase();
        if (lower.includes('commit') && !lower.includes('build')) {
          return {
            rule: 'build-verification',
            description: 'Committing without verifying build',
            severity: 'medium',
          };
        }
        return null;
      },
    });
  }

  // File size limits
  if (rulesContent.includes('500 lines')) {
    rules.push({
      id: 'file-size-limit',
      description: 'Files should be under 500 lines',
      severity: 'low',
      check: (filePath) => {
        try {
          const fullPath = resolve(filePath);
          if (existsSync(fullPath)) {
            const content = readFileSync(fullPath, 'utf-8');
            const lineCount = content.split('\n').length;
            if (lineCount > 500) {
              return {
                rule: 'file-size-limit',
                description: `File has ${lineCount} lines (max 500)`,
                severity: 'low',
                file: filePath,
                line: 500,
              };
            }
          }
        } catch {
          // File not readable, skip
        }
        return null;
      },
    });
  }

  // Naming conventions
  if (rulesContent.includes('naming convention') || rulesContent.includes('typed interface')) {
    rules.push({
      id: 'naming-conventions',
      description: 'Use typed interfaces for all public APIs',
      severity: 'low',
      check: (_filePath, changeDescription) => {
        const lower = changeDescription.toLowerCase();
        if (lower.includes('api') && lower.includes('any')) {
          return {
            rule: 'naming-conventions',
            description: 'Public API may use untyped interfaces',
            severity: 'low',
          };
        }
        return null;
      },
    });
  }

  return rules;
}

/**
 * Validates a file/change against project rules found in CLAUDE.md and AGENTS.md.
 */
export async function validateRules(
  filePath: string,
  changeDescription: string,
  rulesFiles?: string[]
): Promise<ValidationResult> {
  const projectRoot = findProjectRoot(process.cwd());
  const files = rulesFiles ?? DEFAULT_RULES_FILES;
  const rulesContent = loadRulesContent(files, projectRoot);

  if (!rulesContent.trim()) {
    return {
      violations: [],
      compliant: true,
      rulesChecked: 0,
    };
  }

  const parsedRules = buildRules(rulesContent);
  const violations: RuleViolation[] = [];

  for (const rule of parsedRules) {
    const violation = rule.check(filePath, changeDescription);
    if (violation) {
      violations.push(violation);
    }
  }

  return {
    violations,
    compliant: violations.length === 0,
    rulesChecked: parsedRules.length,
  };
}
