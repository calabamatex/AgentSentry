/**
 * scan-security.ts — agent_sentry_scan_security tool: Scan content for security issues.
 */

import { z } from 'zod';
import { MAX_SCAN_BYTES } from '../../primitives/secret-detection';

export const name = 'agent_sentry_scan_security';
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
    probabilistic: {
      type: 'boolean',
      description:
        'When true, enrich each finding with a context-adjusted severity and a heuristic ' +
        'false-positive estimate (e.g. secrets in test fixtures are downgraded). Default false ' +
        '(output unchanged). These are heuristic adjustments, not calibrated probabilities.',
    },
  },
  required: ['content'],
};

export const argsSchema = z.object({
  content: z.string(),
  file_path: z.string().optional(),
  probabilistic: z.boolean().optional(),
});

export interface SecurityFinding {
  type: string;
  severity: string;
  line?: number;
  description: string;
  /** Present only when probabilistic mode is requested. Heuristic, not calibrated. */
  probabilistic?: {
    adjusted_severity: number; // 0..1, context-adjusted
    false_positive_estimate: number; // 0..1
    context_factors: string[]; // e.g. ["test file"]
    basis: 'default_priors';
  };
}

/** Map the discrete severity label to a base numeric severity. */
const SEVERITY_BASE: Record<string, number> = {
  critical: 0.9,
  high: 0.7,
  medium: 0.5,
  low: 0.3,
};

/** Base false-positive rate by finding type (heuristic priors). */
const FP_BASE: Record<string, number> = {
  'api-key': 0.1,
  'private-key': 0.05,
  'hardcoded-password': 0.2,
  'env-var': 0.3,
  'sql-injection': 0.35,
  'eval-usage': 0.4,
};

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|fixtures?)\/|\.(test|spec)\.[tj]sx?$|\.(example|sample)$/i;

/** Attach a heuristic, context-adjusted assessment to a finding. */
function enrich(finding: SecurityFinding, filePath?: string): void {
  const base = SEVERITY_BASE[finding.severity] ?? 0.5;
  const fpBase = FP_BASE[finding.type] ?? 0.2;
  const factors: string[] = [];
  let severity = base;
  let fp = fpBase;
  if (filePath && TEST_FILE.test(filePath)) {
    factors.push('test/fixture file');
    severity *= 0.2; // placeholders in test files are rarely real
    fp = Math.min(1, fp + 0.6);
  }
  finding.probabilistic = {
    adjusted_severity: Math.round(clamp01(severity) * 1000) / 1000,
    false_positive_estimate: Math.round(clamp01(fp) * 1000) / 1000,
    context_factors: factors,
    basis: 'default_priors',
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface ScanSecurityResult {
  findings: SecurityFinding[];
  clean: boolean;
  /** True when input exceeded MAX_SCAN_BYTES and only the prefix was scanned. */
  truncated?: boolean;
}

interface SecurityPattern {
  type: string;
  severity: string;
  pattern: RegExp;
  description: string;
}

/** @internal Exported for the ReDoS audit test (WI-007) only. */
export const SECURITY_PATTERNS: SecurityPattern[] = [
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
  // SQL injection patterns.
  // Bounded quantifiers (WI-007): the original unbounded `.*?` between the
  // opening quote and the sink was 2nd-degree-polynomial under ReDoS analysis.
  // Bounding the gap to 500 non-quote/newline chars is linear and still covers
  // realistic single-line query calls.
  {
    type: 'sql-injection',
    severity: 'high',
    // Gap excludes the '$' it searches for (removes the run/delimiter overlap
    // that made the original `.*?` ~840ms on 500KB); bounded to 500 chars.
    pattern: /(?:query|exec|execute)\s{0,10}\(\s{0,10}['"`][^$\n]{0,500}\$\{/g,
    description: 'Possible SQL injection via template literal interpolation',
  },
  {
    type: 'sql-injection',
    severity: 'high',
    // Gap excludes the '+' it searches for; bounded to 500 chars.
    pattern: /(?:query|exec|execute)\s{0,10}\(\s{0,10}['"][^+\n]{0,500}\+\s{0,10}(?:req\.|args\.|input\.|user)/g,
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
    // Defense-in-depth input cap (WI-007): bound the work any single scan can
    // do, independent of per-pattern complexity. Scanning stops at the cap and
    // the result flags truncation.
    const truncated = parsed.content.length > MAX_SCAN_BYTES;
    const content = truncated ? parsed.content.slice(0, MAX_SCAN_BYTES) : parsed.content;
    const lines = content.split('\n');

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

    if (parsed.probabilistic) {
      for (const f of findings) enrich(f, parsed.file_path);
    }

    const result: ScanSecurityResult = {
      findings,
      clean: findings.length === 0,
      ...(truncated ? { truncated: true } : {}),
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
