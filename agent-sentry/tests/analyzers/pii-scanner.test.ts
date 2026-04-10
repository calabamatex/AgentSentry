import { describe, it, expect } from 'vitest';
import { scanPiiLogging } from '../../src/analyzers/pii-scanner';

describe('PII Scanner', () => {
  it('should detect email in console.log', () => {
    const content = 'console.log("User email:", user.email);';
    const findings = scanPiiLogging(content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].field).toBe('email');
  });

  it('should detect password in logger call', () => {
    const content = 'logger.info("Password changed", { password });';
    const findings = scanPiiLogging(content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].field).toBe('password');
  });

  it('should detect SSN reference', () => {
    const content = 'console.log(user.ssn);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'SSN')).toBe(true);
  });

  it('should detect credit card field', () => {
    const content = 'console.log("Card:", cardNumber);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'credit card')).toBe(true);
  });

  it('should detect date of birth', () => {
    const content = 'console.log("DOB:", user.dateOfBirth);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'date of birth')).toBe(true);
  });

  it('should detect IP address field', () => {
    const content = 'logger.info("Client IP:", clientIp);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'IP address')).toBe(true);
  });

  it('should detect bank account field', () => {
    const content = 'console.log("IBAN:", user.iban);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'bank account')).toBe(true);
  });

  it('should detect medical data field', () => {
    const content = 'console.log("Diagnosis:", patient.diagnosis);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'medical')).toBe(true);
  });

  it('should detect location data', () => {
    const content = 'logger.debug("Coords:", latitude, longitude);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'location')).toBe(true);
  });

  it('should detect national ID field', () => {
    const content = 'console.log("Passport:", user.passport);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'national ID')).toBe(true);
  });

  it('should detect address field', () => {
    const content = 'console.log("Address:", user.address);';
    const findings = scanPiiLogging(content);
    expect(findings.some(f => f.field === 'address')).toBe(true);
  });

  it('should not flag non-logging lines', () => {
    const content = 'const email = user.email;\nreturn email;';
    const findings = scanPiiLogging(content);
    expect(findings).toHaveLength(0);
  });

  it('should skip lock files', () => {
    const content = 'console.log(email);';
    const findings = scanPiiLogging(content, 'package-lock.json');
    expect(findings).toHaveLength(0);
  });

  it('should skip json files', () => {
    const content = 'console.log(email);';
    const findings = scanPiiLogging(content, 'config.json');
    expect(findings).toHaveLength(0);
  });

  it('should report correct line numbers', () => {
    const content = 'const x = 1;\nconsole.log(user.email);\nconst y = 2;';
    const findings = scanPiiLogging(content);
    expect(findings[0].line).toBe(2);
  });
});
