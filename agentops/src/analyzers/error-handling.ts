/**
 * error-handling.ts — Scans source files for external/IO calls missing error handling.
 *
 * Replaces the shell-based grep heuristics in post-write-checks.sh §6.2.2
 * with a structured TypeScript analyzer that supports multiple languages
 * and produces typed findings.
 */

export interface ErrorHandlingFinding {
  line: number;
  callType: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

interface CallPattern {
  label: string;
  pattern: RegExp;
  severity: 'low' | 'medium' | 'high';
}

const CALL_PATTERNS: CallPattern[] = [
  { label: 'fetch()', pattern: /\bfetch\s*\(/g, severity: 'high' },
  { label: 'axios', pattern: /\baxios\.\w+/g, severity: 'high' },
  { label: 'http request', pattern: /\bhttp\.(get|post|put|delete|patch)\b/g, severity: 'high' },
  { label: 'database query', pattern: /\.query\s*\(/g, severity: 'high' },
  { label: 'database execute', pattern: /\.execute\s*\(/g, severity: 'medium' },
  { label: 'fs operation', pattern: /\bfs\.(read|write|unlink|mkdir|rmdir|rename|access)\w*/g, severity: 'medium' },
  { label: 'file system', pattern: /\b(readFile|writeFile|readdir|appendFile)\s*\(/g, severity: 'medium' },
  { label: 'file open', pattern: /\bopen\s*\(/g, severity: 'low' },
  { label: 'subprocess', pattern: /\b(execSync|exec|spawn|spawnSync|fork)\s*\(/g, severity: 'high' },
  { label: 'requests (Python)', pattern: /\brequests\.(get|post|put|delete|patch)\b/g, severity: 'high' },
];

const ERROR_HANDLING_PATTERNS = [
  /\btry\s*\{/,
  /\btry\s*:/,
  /\.catch\s*\(/,
  /\bcatch\s*\(/,
  /\bexcept\s/,
  /\bexcept\s*:/,
  /\bErrorBoundary\b/,
  /\bon_error\b/i,
  /\bonerror\b/i,
];

/**
 * Check if a code window around a line contains error handling.
 */
function hasErrorHandling(lines: string[], lineIndex: number, windowSize = 5): boolean {
  const start = Math.max(0, lineIndex - windowSize);
  const end = Math.min(lines.length, lineIndex + windowSize + 1);
  const context = lines.slice(start, end).join('\n');

  return ERROR_HANDLING_PATTERNS.some((p) => p.test(context));
}

/**
 * Scan content for external/IO calls without nearby error handling.
 *
 * @param content - Source file content
 * @param filePath - Optional file path for filtering (skips lock/map files)
 * @returns Array of findings for unhandled calls
 */
export function scanErrorHandling(
  content: string,
  filePath?: string,
): ErrorHandlingFinding[] {
  // Skip safe file types
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (['lock', 'sum', 'map', 'json', 'md'].includes(ext ?? '')) {
      return [];
    }
  }

  const findings: ErrorHandlingFinding[] = [];
  const lines = content.split('\n');

  for (const { label, pattern, severity } of CALL_PATTERNS) {
    // Reset regex for each scan
    const regex = new RegExp(pattern.source, pattern.flags);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
        continue;
      }

      if (regex.test(line)) {
        if (!hasErrorHandling(lines, i)) {
          findings.push({
            line: i + 1,
            callType: label,
            description: `Unhandled ${label} call — add error handling with graceful fallback`,
            severity,
          });
        }
      }
      // Reset regex for next line
      regex.lastIndex = 0;
    }
  }

  return findings;
}
