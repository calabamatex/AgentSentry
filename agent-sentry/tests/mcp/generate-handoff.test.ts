/**
 * Tests for mcp/tools/generate-handoff.ts — agent_sentry_generate_handoff tool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as childProcess from 'child_process';

// Mock child_process.execFileSync
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { name, description, inputSchema, handler } from '../../src/mcp/tools/generate-handoff';

const mockedExecFileSync = vi.mocked(childProcess.execFileSync);

function mockGitCommands(): void {
  mockedExecFileSync.mockImplementation((_cmd: string, args?: readonly string[]) => {
    const argsStr = (args ?? []).join(' ');
    if (argsStr.includes('branch --show-current')) return 'feature/handoff';
    if (argsStr.includes('rev-parse --abbrev-ref')) return 'feature/handoff';
    if (argsStr.includes('log -1 --oneline')) return 'abc1234 feat: add handoff';
    if (argsStr.includes('status --short')) return ' M src/handoff.ts\nA  src/new-file.ts';
    if (argsStr.includes('diff --stat')) return ' src/handoff.ts | 50 +++\n 1 file changed';
    if (argsStr.includes('log --oneline -10')) return 'abc1234 feat: add handoff\ndef5678 fix: bug';
    return '';
  });
}

describe('agent_sentry_generate_handoff MCP tool', () => {
  beforeEach(() => {
    mockGitCommands();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct name and description', () => {
    expect(name).toBe('agent_sentry_generate_handoff');
    expect(description).toContain('handoff');
  });

  it('has valid input schema', () => {
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.properties).toHaveProperty('session_id');
    expect(inputSchema.properties).toHaveProperty('remaining_work');
    expect(inputSchema.properties).toHaveProperty('session_summary');
    expect(inputSchema.required).toEqual([]);
  });

  it('generates handoff with default args', async () => {
    const result = await handler({});
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.branch).toBe('feature/handoff');
    expect(parsed.last_commit).toContain('abc1234');
    expect(parsed.uncommitted_file_count).toBe(2);
    expect(parsed.recent_commit_count).toBe(2);
    expect(parsed.handoff_document).toContain('Auto-Generated Handoff');
    expect(parsed.handoff_document).toContain('feature/handoff');
  });

  it('includes session_id when provided', async () => {
    const result = await handler({ session_id: 'my-session-123' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.session_id).toBe('my-session-123');
    expect(parsed.handoff_document).toContain('my-session-123');
  });

  it('includes remaining work items', async () => {
    const result = await handler({
      remaining_work: ['Fix auth tests', 'Deploy to staging'],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.remaining_work_count).toBe(2);
    expect(parsed.handoff_document).toContain('Fix auth tests');
    expect(parsed.handoff_document).toContain('Deploy to staging');
    expect(parsed.handoff_document).toContain('Remaining Work');
  });

  it('includes session summary when provided', async () => {
    const result = await handler({
      session_summary: 'Implemented handoff feature with CLI and MCP tool.',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.handoff_document).toContain('Session Summary');
    expect(parsed.handoff_document).toContain('Implemented handoff feature');
  });

  it('includes paste-ready prompt', async () => {
    const result = await handler({
      remaining_work: ['Write tests'],
      session_summary: 'Added handoff command.',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.handoff_document).toContain('Paste-Ready Handoff Prompt');
    expect(parsed.handoff_document).toContain('Pick up where the previous session left off');
    expect(parsed.handoff_document).toContain('Continue work on this project');
  });

  it('handles git failures gracefully', async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.branch).toBe('unknown');
    expect(parsed.last_commit).toBe('no commits');
    expect(parsed.handoff_document).toContain('Auto-Generated Handoff');
  });

  it('includes git state sections in handoff document', async () => {
    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);
    const doc = parsed.handoff_document;

    expect(doc).toContain('## Current State');
    expect(doc).toContain('## Uncommitted Changes');
    expect(doc).toContain('## Diff Stat');
    expect(doc).toContain('## Recent Commits');
  });
});
