/**
 * Tests for the error-handling analyzer.
 */

import { describe, it, expect } from 'vitest';
import { scanErrorHandling } from '../../src/analyzers/error-handling';

describe('scanErrorHandling', () => {
  it('returns empty for safe file types', () => {
    expect(scanErrorHandling('fetch("/api")', 'package-lock.json')).toEqual([]);
    expect(scanErrorHandling('fetch("/api")', 'bundle.js.map')).toEqual([]);
  });

  it('detects unhandled fetch() call', () => {
    const code = `const data = fetch("/api/users");`;
    const findings = scanErrorHandling(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].callType).toBe('fetch()');
    expect(findings[0].line).toBe(1);
  });

  it('does not flag fetch() inside try/catch', () => {
    const code = `
try {
  const data = fetch("/api/users");
} catch (e) {
  console.error(e);
}`;
    const findings = scanErrorHandling(code);
    expect(findings).toHaveLength(0);
  });

  it('does not flag fetch() with .catch()', () => {
    const code = `
fetch("/api/users")
  .then(r => r.json())
  .catch(e => console.error(e));`;
    const findings = scanErrorHandling(code);
    expect(findings).toHaveLength(0);
  });

  it('detects unhandled execSync', () => {
    const code = `const out = execSync("ls -la");`;
    const findings = scanErrorHandling(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].callType).toBe('subprocess');
  });

  it('detects unhandled fs operations', () => {
    const code = `const data = fs.readFileSync("config.json");`;
    const findings = scanErrorHandling(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].callType).toBe('fs operation');
  });

  it('skips comment lines', () => {
    const code = `// fetch("/api/users")`;
    const findings = scanErrorHandling(code);
    expect(findings).toHaveLength(0);
  });

  it('detects multiple unhandled calls', () => {
    const code = `
const a = fetch("/api/a");
const b = axios.get("/api/b");
const c = execSync("whoami");`;
    const findings = scanErrorHandling(code);
    expect(findings).toHaveLength(3);
  });
});
