/**
 * Tests for src/cli/commands/handoff-templates.ts
 *
 * Pure functions (formatHandoff, buildHandoffPrompt) with no external deps.
 * No mocking needed.
 */

import { describe, it, expect } from 'vitest';
import { formatHandoff, buildHandoffPrompt } from '../../../src/cli/commands/handoff-templates';
import type { HandoffResult, TodoItem } from '../../../src/cli/commands/handoff';

function makeResult(overrides: Partial<HandoffResult> = {}): HandoffResult {
  return {
    generated_at: '2024-06-15T12:00:00Z',
    branch: 'main',
    last_commit: 'abc1234 Initial commit',
    uncommitted_changes: '',
    git_diff_stat: '',
    recent_commits: [],
    session_summary: '',
    remaining_work: [],
    todos: [],
    handoff_prompt: 'Continue where you left off.',
    ...overrides,
  };
}

describe('formatHandoff', () => {
  it('produces markdown with front matter', () => {
    const md = formatHandoff(makeResult());
    expect(md).toContain('---');
    expect(md).toContain('name: Auto-handoff');
    expect(md).toContain('type: project');
  });

  it('includes branch and last commit', () => {
    const md = formatHandoff(makeResult({ branch: 'feature/x', last_commit: 'deadbeef Fix bug' }));
    expect(md).toContain('**Branch**: feature/x');
    expect(md).toContain('**Last commit**: deadbeef Fix bug');
  });

  it('includes generated_at timestamp', () => {
    const md = formatHandoff(makeResult({ generated_at: '2024-06-15T12:00:00Z' }));
    expect(md).toContain('Generated: 2024-06-15T12:00:00Z');
  });

  it('includes session summary when present', () => {
    const md = formatHandoff(makeResult({ session_summary: 'Worked on auth module.' }));
    expect(md).toContain('## Session Summary');
    expect(md).toContain('Worked on auth module.');
  });

  it('omits session summary when empty', () => {
    const md = formatHandoff(makeResult({ session_summary: '' }));
    expect(md).not.toContain('## Session Summary');
  });

  it('includes uncommitted changes in code block', () => {
    const md = formatHandoff(makeResult({ uncommitted_changes: 'M src/index.ts' }));
    expect(md).toContain('## Uncommitted Changes');
    expect(md).toContain('```');
    expect(md).toContain('M src/index.ts');
  });

  it('omits uncommitted changes when empty', () => {
    const md = formatHandoff(makeResult({ uncommitted_changes: '' }));
    expect(md).not.toContain('## Uncommitted Changes');
  });

  it('includes git diff stat in code block', () => {
    const md = formatHandoff(makeResult({ git_diff_stat: '3 files changed' }));
    expect(md).toContain('## Recent Diff');
    expect(md).toContain('3 files changed');
  });

  it('omits diff stat when empty', () => {
    const md = formatHandoff(makeResult({ git_diff_stat: '' }));
    expect(md).not.toContain('## Recent Diff');
  });

  it('includes recent commits', () => {
    const md = formatHandoff(makeResult({ recent_commits: ['abc Fix A', 'def Fix B'] }));
    expect(md).toContain('## Recent Commits');
    expect(md).toContain('abc Fix A');
    expect(md).toContain('def Fix B');
  });

  it('omits recent commits when empty', () => {
    const md = formatHandoff(makeResult({ recent_commits: [] }));
    expect(md).not.toContain('## Recent Commits');
  });

  it('includes remaining work items', () => {
    const md = formatHandoff(makeResult({ remaining_work: ['Fix tests', 'Update docs'] }));
    expect(md).toContain('## Remaining Work');
    expect(md).toContain('- Fix tests');
    expect(md).toContain('- Update docs');
  });

  it('omits remaining work when empty', () => {
    const md = formatHandoff(makeResult({ remaining_work: [] }));
    expect(md).not.toContain('## Remaining Work');
  });

  it('includes todos with status icons', () => {
    const todos: TodoItem[] = [
      { content: 'Write tests', status: 'completed' },
      { content: 'Add logging', status: 'in_progress' },
      { content: 'Refactor', status: 'pending' },
    ];
    const md = formatHandoff(makeResult({ todos }));
    expect(md).toContain('## Task List');
    expect(md).toContain('- [x] Write tests');
    expect(md).toContain('- [~] Add logging');
    expect(md).toContain('- [ ] Refactor');
  });

  it('omits todos when empty', () => {
    const md = formatHandoff(makeResult({ todos: [] }));
    expect(md).not.toContain('## Task List');
  });

  it('includes the handoff prompt in a code block', () => {
    const md = formatHandoff(makeResult({ handoff_prompt: 'Do the thing.' }));
    expect(md).toContain('## Handoff Prompt');
    expect(md).toContain('Do the thing.');
  });
});

describe('buildHandoffPrompt', () => {
  function makePartial(overrides: Partial<Omit<HandoffResult, 'handoff_prompt'>> = {}) {
    return {
      generated_at: '2024-06-15T12:00:00Z',
      branch: 'main',
      last_commit: 'abc1234 Initial commit',
      uncommitted_changes: '',
      git_diff_stat: '',
      recent_commits: [],
      session_summary: '',
      remaining_work: [],
      todos: [],
      ...overrides,
    };
  }

  it('includes branch and last commit', () => {
    const prompt = buildHandoffPrompt(makePartial({ branch: 'dev', last_commit: 'xyz' }));
    expect(prompt).toContain('Branch: dev');
    expect(prompt).toContain('Last commit: xyz');
  });

  it('includes instruction to read handoff', () => {
    const prompt = buildHandoffPrompt(makePartial());
    expect(prompt).toContain('Read the handoff');
  });

  it('ends with pickup instruction', () => {
    const prompt = buildHandoffPrompt(makePartial());
    expect(prompt).toContain('Pick up where the previous session left off.');
  });

  it('includes uncommitted changes when present', () => {
    const prompt = buildHandoffPrompt(makePartial({ uncommitted_changes: 'M foo.ts' }));
    expect(prompt).toContain('Uncommitted changes:');
    expect(prompt).toContain('M foo.ts');
  });

  it('omits uncommitted changes when empty', () => {
    const prompt = buildHandoffPrompt(makePartial({ uncommitted_changes: '' }));
    expect(prompt).not.toContain('Uncommitted changes:');
  });

  it('includes recent commits (max 5)', () => {
    const commits = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    const prompt = buildHandoffPrompt(makePartial({ recent_commits: commits }));
    expect(prompt).toContain('Recent commits:');
    expect(prompt).toContain('c5');
    expect(prompt).not.toContain('c6');
  });

  it('omits recent commits when empty', () => {
    const prompt = buildHandoffPrompt(makePartial({ recent_commits: [] }));
    expect(prompt).not.toContain('Recent commits:');
  });

  it('includes remaining work', () => {
    const prompt = buildHandoffPrompt(makePartial({ remaining_work: ['Fix tests'] }));
    expect(prompt).toContain('Remaining work:');
    expect(prompt).toContain('- Fix tests');
  });

  it('omits remaining work when empty', () => {
    const prompt = buildHandoffPrompt(makePartial({ remaining_work: [] }));
    expect(prompt).not.toContain('Remaining work:');
  });

  it('includes incomplete todos only', () => {
    const todos: TodoItem[] = [
      { content: 'Done task', status: 'completed' },
      { content: 'Active task', status: 'in_progress' },
      { content: 'Pending task', status: 'pending' },
    ];
    const prompt = buildHandoffPrompt(makePartial({ todos }));
    expect(prompt).toContain('Incomplete tasks');
    expect(prompt).not.toContain('Done task');
    expect(prompt).toContain('[in progress] Active task');
    expect(prompt).toContain('[pending] Pending task');
  });

  it('omits incomplete todos section when all completed', () => {
    const todos: TodoItem[] = [
      { content: 'Done', status: 'completed' },
    ];
    const prompt = buildHandoffPrompt(makePartial({ todos }));
    expect(prompt).not.toContain('Incomplete tasks');
  });
});
