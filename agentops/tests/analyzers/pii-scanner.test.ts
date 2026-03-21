/**
 * Tests for the PII scanner analyzer.
 */

import { describe, it, expect } from 'vitest';
import { scanPiiLogging } from '../../src/analyzers/pii-scanner';

describe('scanPiiLogging', () => {
  it('returns empty for non-code files', () => {
    expect(scanPiiLogging('console.log(email)', 'data.json')).toEqual([]);
    expect(scanPiiLogging('console.log(email)', 'README.md')).toEqual([]);
  });

  it('detects PII in console.log', () => {
    const code = `console.log("User email:", user.email);`;
    const findings = scanPiiLogging(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('email');
    expect(findings[0].line).toBe(1);
  });

  it('detects password in console.error', () => {
    const code = `console.error("Auth failed", { password });`;
    const findings = scanPiiLogging(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('password');
  });

  it('detects token in logger call', () => {
    const code = `logger.info("Session token:", token);`;
    const findings = scanPiiLogging(code);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('token');
  });

  it('does not flag non-logging lines', () => {
    const code = `const email = user.email;`;
    const findings = scanPiiLogging(code);
    expect(findings).toHaveLength(0);
  });

  it('detects multiple PII fields in one log line', () => {
    const code = `console.log("User:", { email, phone, ssn });`;
    const findings = scanPiiLogging(code);
    expect(findings).toHaveLength(3);
    const fields = findings.map((f) => f.field);
    expect(fields).toContain('email');
    expect(fields).toContain('phone');
    expect(fields).toContain('SSN');
  });

  it('detects PII in Python logging', () => {
    const code = `logging.info("User password: %s", password)`;
    const findings = scanPiiLogging(code, 'app.py');
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('password');
  });
});
