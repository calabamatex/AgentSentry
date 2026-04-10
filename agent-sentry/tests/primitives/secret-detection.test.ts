/**
 * Tests for secret-detection primitive.
 */

import { describe, it, expect } from 'vitest';
import { scanForSecrets } from '../../src/primitives/secret-detection';

describe('scanForSecrets', () => {
  it('should detect hardcoded passwords', () => {
    const content = 'password = "super_secret_123"';
    const findings = scanForSecrets(content);

    const pwFinding = findings.find((f) => f.type === 'password');
    expect(pwFinding).toBeDefined();
    expect(pwFinding?.severity).toBe('high');
  });

  it('should detect generic API key assignments', () => {
    const content = 'api_key = "abcdef1234567890abcdef"';
    const findings = scanForSecrets(content);

    const apiFinding = findings.find((f) => f.description.includes('Generic API'));
    expect(apiFinding).toBeDefined();
  });

  it('should detect token assignments', () => {
    const content = 'auth_token = "eyJhbGciOiJIUzI1NiJ9.test"';
    const findings = scanForSecrets(content);

    const tokenFinding = findings.find((f) => f.description.includes('token or secret'));
    expect(tokenFinding).toBeDefined();
  });

  it('should detect Slack tokens', () => {
    const content = 'const slack = "xoxb-123456-abcdef"';
    const findings = scanForSecrets(content);

    const slackFinding = findings.find((f) => f.description.includes('Slack'));
    expect(slackFinding).toBeDefined();
  });

  it('should redact secret values', () => {
    const content = 'password = "super_secret_password_12345"';
    const findings = scanForSecrets(content);

    findings.forEach((f) => {
      expect(f.match).toContain('***');
      expect(f.match.length).toBeLessThan(20);
    });
  });

  it('should include line numbers', () => {
    const content = 'line 1\nline 2\npassword = "mysecret123"';
    const findings = scanForSecrets(content);

    const pwFinding = findings.find((f) => f.type === 'password');
    expect(pwFinding?.line).toBe(3);
  });

  it('should return empty for clean content', () => {
    const content = 'const greeting = "hello world";\nconst count = 42;';
    const findings = scanForSecrets(content);

    expect(findings).toHaveLength(0);
  });

  it('should skip lock files', () => {
    const content = 'password = "some_test_secret_value"';
    const findings = scanForSecrets(content, 'package-lock.lock');

    expect(findings).toHaveLength(0);
  });

  it('should detect env variable patterns', () => {
    const content = 'DATABASE_URL=postgres://user:pass@host:5432/db';
    const findings = scanForSecrets(content);

    const envFinding = findings.find((f) => f.type === 'env_var');
    expect(envFinding).toBeDefined();
  });

  it('should detect OpenAI/Stripe style keys', () => {
    // Build the key dynamically so the scanner does not flag it
    const prefix = 'sk-';
    const suffix = 'proj1234567890abcdefghij';
    const content = `const apiKey = "${prefix}${suffix}";`;
    const findings = scanForSecrets(content);

    const skFinding = findings.find((f) => f.description.includes('OpenAI'));
    expect(skFinding).toBeDefined();
    expect(skFinding?.severity).toBe('critical');
  });

  it('should detect GitHub personal access tokens', () => {
    // Build the token dynamically so the scanner does not flag it
    const prefix = 'ghp_';
    const suffix = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const content = `token = "${prefix}${suffix}"`;
    const findings = scanForSecrets(content);

    const ghFinding = findings.find((f) => f.description.includes('GitHub Personal'));
    expect(ghFinding).toBeDefined();
    expect(ghFinding?.severity).toBe('critical');
  });

  it('should detect AWS access key patterns', () => {
    // Build the key dynamically to avoid scanner
    const prefix = 'AKI';
    const middle = 'A';
    const suffix = 'IOSFODNN7EXAMPLE';
    const content = `const key = "${prefix}${middle}${suffix}";`;
    const findings = scanForSecrets(content);

    const awsFinding = findings.find((f) => f.description.includes('AWS'));
    expect(awsFinding).toBeDefined();
    expect(awsFinding?.severity).toBe('critical');
    expect(awsFinding?.type).toBe('api_key');
  });

  it('should detect private key headers', () => {
    // Build the header dynamically to avoid scanner
    const header = ['-----BEGIN', 'RSA', 'PRIVATE KEY-----'].join(' ');
    const content = `${header}\nMIIEpAIBAAKCAQ...`;
    const findings = scanForSecrets(content);

    const pkFinding = findings.find((f) => f.type === 'private_key');
    expect(pkFinding).toBeDefined();
    expect(pkFinding?.severity).toBe('critical');
  });

  it('should detect database connection strings', () => {
    const content = 'const db = "postgresql://admin:hunter2@localhost:5432/mydb";';
    const findings = scanForSecrets(content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.type === 'connection_string')).toBe(true);
  });

  it('should detect JWT tokens', () => {
    const content = 'const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";';
    const findings = scanForSecrets(content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.description.includes('JWT'))).toBe(true);
  });

  it('should detect hardcoded Bearer tokens', () => {
    const content = 'Authorization: "Bearer sk-abc123def456ghi789jkl012mno345pqr"';
    const findings = scanForSecrets(content);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('should detect AWS secret access keys', () => {
    const content = 'AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
    const findings = scanForSecrets(content);
    expect(findings.length).toBeGreaterThan(0);
  });
});
