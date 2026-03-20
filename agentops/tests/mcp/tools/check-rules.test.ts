/**
 * check-rules.test.ts — Tests for agentops_check_rules tool (delegates to rules-validation primitive).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockValidateRules = vi.fn();

vi.mock('../../../src/primitives/rules-validation', () => ({
  validateRules: mockValidateRules,
}));

import { handler } from '../../../src/mcp/tools/check-rules';

describe('agentops_check_rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return compliant when primitive reports no violations', async () => {
    mockValidateRules.mockResolvedValue({
      violations: [],
      compliant: true,
      rulesChecked: 4,
    });

    const result = await handler({
      file_path: 'src/mcp/tools/check-git.ts',
      change_description: 'Add error handling to git tool',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(true);
    expect(parsed.violations).toEqual([]);
    expect(parsed.rules_checked).toBe(4);
    expect(mockValidateRules).toHaveBeenCalledWith(
      'src/mcp/tools/check-git.ts',
      'Add error handling to git tool',
    );
  });

  it('should pass file_path and change_description to validateRules', async () => {
    mockValidateRules.mockResolvedValue({
      violations: [],
      compliant: true,
      rulesChecked: 2,
    });

    await handler({
      file_path: 'src/foo.ts',
      change_description: 'update foo',
    });

    expect(mockValidateRules).toHaveBeenCalledWith('src/foo.ts', 'update foo');
  });

  it('should return violations from the primitive', async () => {
    mockValidateRules.mockResolvedValue({
      violations: [
        {
          rule: 'security-no-secrets',
          description: 'File may contain secrets or credentials',
          severity: 'critical',
          file: '.env.production',
        },
      ],
      compliant: false,
      rulesChecked: 5,
    });

    const result = await handler({
      file_path: '.env.production',
      change_description: 'Add production env variables',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(false);
    expect(parsed.violations).toHaveLength(1);
    expect(parsed.violations[0].rule).toBe('security-no-secrets');
    expect(parsed.violations[0].severity).toBe('critical');
  });

  it('should return multiple violations when primitive finds several', async () => {
    mockValidateRules.mockResolvedValue({
      violations: [
        {
          rule: 'file-org-no-root',
          description: 'File saved to root folder violates file organization rules',
          severity: 'high',
          file: 'my-file.ts',
        },
        {
          rule: 'testing-required',
          description: 'Code changes detected without mention of testing',
          severity: 'medium',
        },
      ],
      compliant: false,
      rulesChecked: 6,
    });

    const result = await handler({
      file_path: 'my-file.ts',
      change_description: 'Create a new utility class',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(false);
    expect(parsed.violations).toHaveLength(2);
    expect(parsed.rules_checked).toBe(6);
  });

  it('should handle errors from the primitive gracefully', async () => {
    mockValidateRules.mockRejectedValue(new Error('Failed to read CLAUDE.md'));

    const result = await handler({
      file_path: 'src/server.ts',
      change_description: 'Minor update',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBe('Failed to read CLAUDE.md');
  });

  it('should require both file_path and change_description', async () => {
    const result = await handler({ file_path: 'test.ts' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBeDefined();
  });

  it('should return rules_checked count from the primitive', async () => {
    mockValidateRules.mockResolvedValue({
      violations: [],
      compliant: true,
      rulesChecked: 0,
    });

    const result = await handler({
      file_path: 'src/foo.ts',
      change_description: 'update foo',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.rules_checked).toBe(0);
  });
});
