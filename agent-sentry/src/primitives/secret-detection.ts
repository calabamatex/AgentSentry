/**
 * secret-detection.ts — Scans content for hardcoded secrets.
 * Used by Skills 1 (save_points) and 5 (proactive_safety).
 */

export interface SecretFinding {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  line?: number;
  match: string;
  description: string;
}

interface SecretPattern {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  pattern: RegExp;
  description: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'api_key',
    severity: 'critical',
    pattern: /AKIA[0-9A-Z]{16}/g,
    description: 'AWS Access Key ID detected',
  },
  {
    type: 'token',
    severity: 'critical',
    pattern: /ghp_[0-9a-zA-Z]{36}/g,
    description: 'GitHub Personal Access Token detected',
  },
  {
    type: 'token',
    severity: 'critical',
    pattern: /gho_[0-9a-zA-Z]{36}/g,
    description: 'GitHub OAuth Token detected',
  },
  {
    type: 'token',
    severity: 'critical',
    pattern: /github_pat_[0-9a-zA-Z_]{82}/g,
    description: 'GitHub Fine-Grained PAT detected',
  },
  {
    type: 'api_key',
    severity: 'critical',
    pattern: /sk-[0-9a-zA-Z]{20,}/g,
    description: 'OpenAI/Stripe secret key detected',
  },
  {
    type: 'api_key',
    severity: 'high',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,
    description: 'Generic API key assignment detected',
  },
  {
    type: 'password',
    severity: 'high',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    description: 'Hardcoded password detected',
  },
  {
    type: 'private_key',
    severity: 'critical',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    description: 'Private key detected',
  },
  {
    type: 'env_var',
    severity: 'medium',
    pattern: /^[A-Z_]{2,}=\S{8,}$/gm,
    description: 'Environment variable with value detected (possible .env content)',
  },
  {
    type: 'token',
    severity: 'high',
    pattern: /(?:token|secret|auth)\s*[:=]\s*['"][a-zA-Z0-9_\-/.]{16,}['"]/gi,
    description: 'Hardcoded token or secret detected',
  },
  {
    type: 'api_key',
    severity: 'high',
    pattern: /xox[bpors]-[0-9a-zA-Z-]{10,}/g,
    description: 'Slack token detected',
  },
  {
    type: 'token',
    severity: 'high',
    pattern: /(?:Authorization|authorization)\s*[:=]\s*['"]Bearer\s+[a-zA-Z0-9_\-/.]{10,}['"]/g,
    description: 'Hardcoded Bearer token detected',
  },
  {
    type: 'connection_string',
    severity: 'critical',
    pattern: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"]{10,}/gi,
    description: 'Database connection string with credentials detected',
  },
  {
    type: 'token',
    severity: 'high',
    pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    description: 'JSON Web Token (JWT) detected',
  },
  {
    type: 'api_key',
    severity: 'critical',
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/g,
    description: 'AWS Secret Access Key detected',
  },
];

/**
 * Redacts a secret value, showing only the first 4 characters.
 */
function redact(value: string): string {
  if (value.length <= 4) return '****';
  return value.substring(0, 4) + '***';
}

/**
 * Extracts the secret portion from a matched string.
 * For assignment patterns (key=value), returns just the value part.
 */
function extractSecret(match: string): string {
  const assignmentMatch = match.match(/[:=]\s*['"]?([^'"]+)['"]?$/);
  if (assignmentMatch) {
    return assignmentMatch[1];
  }
  return match;
}

/**
 * Scans content for hardcoded secrets and credentials.
 * @param content - The text content to scan
 * @param filePath - Optional file path for context
 * @returns Array of findings with redacted secret values
 */
export function scanForSecrets(
  content: string,
  filePath?: string
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split('\n');

  // Skip scanning for known safe file types
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (['lock', 'sum', 'map'].includes(ext ?? '')) {
      return findings;
    }
  }

  for (const secretPattern of SECRET_PATTERNS) {
    // Reset regex state for global patterns
    const regex = new RegExp(secretPattern.pattern.source, secretPattern.pattern.flags);

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const secretValue = extractSecret(match[0]);
        findings.push({
          type: secretPattern.type,
          severity: secretPattern.severity,
          line: lineNum + 1,
          match: redact(secretValue),
          description: secretPattern.description,
        });
      }
    }
  }

  return findings;
}
