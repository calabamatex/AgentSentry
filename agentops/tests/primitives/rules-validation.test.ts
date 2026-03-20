/**
 * Tests for rules-validation primitive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { validateRules } from '../../src/primitives/rules-validation';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
});

const MOCK_RULES = `
# Project Rules

## File Organization
- NEVER save to root folder
- Use /src for source code

## Security Rules
- NEVER hardcode API keys, secrets, or credentials

## Build & Test
- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Architecture
- Keep files under 500 lines
- Use typed interfaces for all public APIs
`;

describe('validateRules', () => {
  it('should return no violations for compliant changes', async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path).endsWith('CLAUDE.md')) return true;
      if (String(path).endsWith('.git')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(MOCK_RULES);

    const result = await validateRules('src/utils/helper.ts', 'Added helper function with tests');

    expect(result.compliant).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.rulesChecked).toBeGreaterThan(0);
  });

  it('should detect root folder violations', async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path).endsWith('CLAUDE.md')) return true;
      if (String(path).endsWith('.git')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(MOCK_RULES);

    const result = await validateRules('test.ts', 'Added test file');

    const rootViolation = result.violations.find((v) => v.rule === 'file-org-no-root');
    expect(rootViolation).toBeDefined();
    expect(rootViolation?.severity).toBe('high');
  });

  it('should detect potential secret files', async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path).endsWith('CLAUDE.md')) return true;
      if (String(path).endsWith('.git')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(MOCK_RULES);

    const result = await validateRules('.env', 'Added environment config');

    const secretViolation = result.violations.find((v) => v.rule === 'security-no-secrets');
    expect(secretViolation).toBeDefined();
    expect(secretViolation?.severity).toBe('critical');
  });

  it('should detect missing test mentions in code changes', async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path).endsWith('CLAUDE.md')) return true;
      if (String(path).endsWith('.git')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(MOCK_RULES);

    const result = await validateRules('src/service.ts', 'Added new class for auth');

    const testViolation = result.violations.find((v) => v.rule === 'testing-required');
    expect(testViolation).toBeDefined();
    expect(testViolation?.severity).toBe('medium');
  });

  it('should return empty result when no rules files found', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await validateRules('src/file.ts', 'some change');

    expect(result.rulesChecked).toBe(0);
    expect(result.compliant).toBe(true);
  });

  it('should accept custom rules files', async () => {
    mockExistsSync.mockImplementation((path) => {
      if (String(path).endsWith('CUSTOM_RULES.md')) return true;
      if (String(path).endsWith('.git')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue('# Custom\n- NEVER hardcode secrets');

    const result = await validateRules('.env', 'config', ['CUSTOM_RULES.md']);

    expect(result.rulesChecked).toBeGreaterThan(0);
  });
});
