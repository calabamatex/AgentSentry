/**
 * check-rules.test.ts — Tests for agentops_check_rules tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { handler } from '../../../src/mcp/tools/check-rules';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = fs.readFileSync as unknown as ReturnType<typeof vi.fn>;

describe('agentops_check_rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('should return compliant for normal file change', async () => {
    const result = await handler({
      file_path: 'src/mcp/tools/check-git.ts',
      change_description: 'Add error handling to git tool',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(true);
    expect(parsed.violations).toEqual([]);
  });

  it('should detect root folder violations', async () => {
    const result = await handler({
      file_path: 'my-file.ts',
      change_description: 'Create a new utility file',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(false);
    expect(parsed.violations.length).toBeGreaterThan(0);
    expect(parsed.violations[0].rule).toBe('no-root-files');
  });

  it('should detect .env file violations', async () => {
    const result = await handler({
      file_path: '.env.production',
      change_description: 'Add production env variables',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(false);
    const secretViolation = parsed.violations.find(
      (v: { rule: string }) => v.rule === 'no-secrets',
    );
    expect(secretViolation).toBeDefined();
    expect(secretViolation.severity).toBe('critical');
  });

  it('should detect credentials file violations', async () => {
    const result = await handler({
      file_path: 'credentials.json',
      change_description: 'Update service credentials',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(false);
  });

  it('should check against CLAUDE.md DO NOT CHANGE rules', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return String(p).endsWith('CLAUDE.md');
    });
    mockReadFileSync.mockReturnValue(
      '## DO NOT CHANGE\n- audit-logger.ts, event-bus.ts, trace-context.ts\n',
    );

    const result = await handler({
      file_path: 'src/audit-logger.ts',
      change_description: 'Modify audit-logger.ts to add new logging format',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(false);
    const doNotChange = parsed.violations.find(
      (v: { rule: string }) => v.rule === 'do-not-change',
    );
    expect(doNotChange).toBeDefined();
    expect(doNotChange.severity).toBe('critical');
  });

  it('should pass when change does not violate rules', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      return String(p).endsWith('CLAUDE.md');
    });
    mockReadFileSync.mockReturnValue(
      '## Rules\n- ALWAYS run tests\n- Use TypeScript\n',
    );

    const result = await handler({
      file_path: 'src/mcp/server.ts',
      change_description: 'Add new MCP tool registration',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.compliant).toBe(true);
  });

  it('should handle unreadable rule files gracefully', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await handler({
      file_path: 'src/mcp/server.ts',
      change_description: 'Minor update',
    });
    const parsed = JSON.parse(result.content[0].text);

    // Should not error out, just skip the rules check
    expect(parsed).toBeDefined();
    expect(Array.isArray(parsed.violations)).toBe(true);
  });

  it('should require both file_path and change_description', async () => {
    const result = await handler({ file_path: 'test.ts' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBeDefined();
  });
});
