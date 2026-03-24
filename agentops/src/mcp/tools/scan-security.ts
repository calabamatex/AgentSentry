/**
 * scan-security.ts — agent_sentry_scan_security tool: Scan content for security issues.
 */

import { z } from 'zod';

export const name = 'agentops_scan_security';
export const description =
  'Scan code content for security issues: API keys, hardcoded passwords, SQL injection patterns, eval usage, and private keys.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    content: {
      type: 'string',
      description: 'The content to scan for security issues',
    },
    file_path: {
      type: 'string',
      description: 'Optional file path for contextual reporting',
    },
  },
  required: ['content'],
};

export const argsSchema = z.object({
  content: z.string(),
  file_path: z.string().optional(),
});

export interface SecurityFinding {
  type: string;
  severity: string;
  line?: number;
  description: string;
}

export interface ScanSecurityResult {
  findings: SecurityFinding[];
  clean: boolean;
}

interface SecurityPattern {
  type: string;
  severity: string;
  pattern: RegExp;
  description: string;
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  // API Keys
  {
    type: 'api-key',
    severity: 'critical',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi,
    description: 'Possible hardcoded API key detected',
  },
  {
    type: 'api-key',
    severity: 'critical',
    pattern: /(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}/g,
    description: 'Stripe-style API key detected',
  },
  {
    type: 'api-key',
    severity: 'critical',
    pattern: /AIza[a-zA-Z0-9_\\-]{35}/g,
    description: 'Google API key detected',
  },
  {
    type: 'api-key',
    severity: 'critical',
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    description: 'GitHub personal access token detected',
  },
  {
    type: 'api-key',
    severity: 'critical',
    pattern: /(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}/g,
    description: 'AWS access key ID detected',
  },
  // Environment variables with values
  {
    type: 'env-var',
    severity: 'high',
    pattern: /(?:process\.env\.[A-Z_]+\s*(?:\|\||\?\?)\s*['"][^'"]{8,}['"])/g,
    description: 'Environment variable with hardcoded fallback value',
  },
  // Hardcoded passwords
  {
    type: 'hardcoded-password',
    severity: 'critical',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    description: 'Possible hardcoded password detected',
  },
  {
    type: 'hardcoded-password',
    severity: 'critical',
    pattern: /(?:secret|token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{8,}['"]/gi,
    description: 'Possible hardcoded secret or token detected',
  },
  // SQL injection patterns
  {
    type: 'sql-injection',
    severity: 'high',
    pattern: /(?:query|exec|execute)\s*\(\s*['"`].*?\$\{/g,
    description: 'Possible SQL injection via template literal interpolation',
  },
  {
    type: 'sql-injection',
    severity: 'high',
    pattern: /(?:query|exec|execute)\s*\(\s*['"].*?\+\s*(?:req\.|args\.|input\.|user)/g,
    description: 'Possible SQL injection via string concatenation with user input',
  },
  // eval usage
  {
    type: 'eval-usage',
    severity: 'high',
    pattern: /\beval\s*\(/g,
    description: 'Use of eval() detected — potential code injection risk',
  },
  {
    type: 'eval-usage',
    severity: 'medium',
    pattern: /new\s+Function\s*\(/g,
    description: 'Use of new Function() detected — similar risks to eval()',
  },
  // Private keys
  {
    type: 'private-key',
    severity: 'critical',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    description: 'Private key detected in content',
  },
];

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const parsed = argsSchema.parse(args);
    const findings: SecurityFinding[] = [];
    const lines = parsed.content.split('\n');

    for (const secPattern of SECURITY_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Reset regex state for global patterns
        secPattern.pattern.lastIndex = 0;
        if (secPattern.pattern.test(line)) {
          findings.push({
            type: secPattern.type,
            severity: secPattern.severity,
            line: i + 1,
            description: secPattern.description,
          });
        }
      }
    }

    const result: ScanSecurityResult = {
      findings,
      clean: findings.length === 0,
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
