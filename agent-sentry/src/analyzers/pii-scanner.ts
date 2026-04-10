/**
 * pii-scanner.ts — Scans logging statements for PII field references.
 *
 * Replaces the shell-based grep heuristics in post-write-checks.sh §6.2.3
 * with a structured TypeScript analyzer that produces typed findings.
 */

export interface PiiFinding {
  line: number;
  field: string;
  severity: 'medium' | 'high';
  description: string;
}

/** Logging call patterns (JS + Python). */
const LOG_PATTERNS = [
  /console\.(log|warn|error|info|debug)\s*\(/,
  /logging\.(debug|info|warning|error|critical)\s*\(/,
  /\blogger\.\w+\s*\(/,
  /\bprint\s*\(/,
];

/** Sensitive field names that should never appear in logs. */
const PII_FIELDS: Array<{ name: string; pattern: RegExp; severity: 'medium' | 'high' }> = [
  { name: 'email', pattern: /\bemail\b/i, severity: 'high' },
  { name: 'password', pattern: /\b(password|passwd)\b/i, severity: 'high' },
  { name: 'credit card', pattern: /\b(card|credit_?card|card_?number|cardNumber)\b/i, severity: 'high' },
  { name: 'SSN', pattern: /\b(ssn|social_?security|socialSecurity)\b/i, severity: 'high' },
  { name: 'phone', pattern: /\b(phone|phone_?number|phoneNumber)\b/i, severity: 'medium' },
  { name: 'secret', pattern: /\bsecret\b/i, severity: 'high' },
  { name: 'token', pattern: /\btoken\b/i, severity: 'high' },
  { name: 'API key', pattern: /\b(api_?key|apiKey)\b/i, severity: 'high' },
  { name: 'address', pattern: /\b(address|street_?address|mailing_?address)\b/i, severity: 'medium' },
  { name: 'date of birth', pattern: /\b(dob|date_?of_?birth|dateOfBirth|birth_?date|birthDate)\b/i, severity: 'high' },
  { name: 'IP address', pattern: /\b(ip_?address|ipAddress|client_?ip|clientIp|remote_?addr)\b/i, severity: 'medium' },
  { name: 'national ID', pattern: /\b(national_?id|passport|driver_?license|driverLicense)\b/i, severity: 'high' },
  { name: 'bank account', pattern: /\b(bank_?account|iban|routing_?number|account_?number)\b/i, severity: 'high' },
  { name: 'medical', pattern: /\b(diagnosis|medical_?record|health_?data|patient_?id)\b/i, severity: 'high' },
  { name: 'location', pattern: /\b(latitude|longitude|geo_?location|geoLocation|coordinates)\b/i, severity: 'medium' },
];

/**
 * Check if a line contains a logging call.
 */
function isLoggingLine(line: string): boolean {
  return LOG_PATTERNS.some((p) => p.test(line));
}

/**
 * Scan content for PII references inside logging statements.
 *
 * @param content - Source file content
 * @param filePath - Optional file path for filtering
 * @returns Array of PII findings
 */
export function scanPiiLogging(
  content: string,
  filePath?: string,
): PiiFinding[] {
  // Skip non-code files
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (['lock', 'sum', 'map', 'json', 'md', 'txt'].includes(ext ?? '')) {
      return [];
    }
  }

  const findings: PiiFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!isLoggingLine(line)) continue;

    for (const { name, pattern, severity } of PII_FIELDS) {
      if (pattern.test(line)) {
        findings.push({
          line: i + 1,
          field: name,
          severity,
          description: `PII field '${name}' referenced in logging statement`,
        });
      }
    }
  }

  return findings;
}
