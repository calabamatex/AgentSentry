/**
 * handoff-templates.ts — Formatting and template logic extracted from handoff.ts.
 *
 * Houses the markdown formatter and the paste-ready prompt builder
 * to keep handoff.ts under 500 lines.
 */

import type { HandoffResult, TodoItem } from './handoff';

/** Format a HandoffResult into a full markdown handoff document. */
export function formatHandoff(result: HandoffResult): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`name: Auto-handoff — ${new Date().toISOString().slice(0, 10)}`);
  lines.push('description: Auto-generated handoff for fresh session continuity');
  lines.push('type: project');
  lines.push('---');
  lines.push('');
  lines.push('# Session Handoff (Auto-Generated)');
  lines.push('');
  lines.push(`Generated: ${result.generated_at}`);
  lines.push('');

  // Current state
  lines.push('## Current State');
  lines.push(`- **Branch**: ${result.branch}`);
  lines.push(`- **Last commit**: ${result.last_commit}`);
  lines.push('');

  // Session summary
  if (result.session_summary) {
    lines.push('## Session Summary');
    lines.push(result.session_summary);
    lines.push('');
  }

  // Uncommitted changes
  if (result.uncommitted_changes) {
    lines.push('## Uncommitted Changes');
    lines.push('```');
    lines.push(result.uncommitted_changes);
    lines.push('```');
    lines.push('');
  }

  // Diff stat
  if (result.git_diff_stat) {
    lines.push('## Recent Diff');
    lines.push('```');
    lines.push(result.git_diff_stat);
    lines.push('```');
    lines.push('');
  }

  // Recent commits
  if (result.recent_commits.length > 0) {
    lines.push('## Recent Commits');
    lines.push('```');
    for (const commit of result.recent_commits) {
      lines.push(commit);
    }
    lines.push('```');
    lines.push('');
  }

  // Remaining work
  if (result.remaining_work.length > 0) {
    lines.push('## Remaining Work');
    for (const item of result.remaining_work) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // Todos
  if (result.todos.length > 0) {
    lines.push('## Task List (TodoWrite State)');
    for (const todo of result.todos) {
      const icon = todo.status === 'completed' ? '[x]' : todo.status === 'in_progress' ? '[~]' : '[ ]';
      lines.push(`- ${icon} ${todo.content}`);
    }
    lines.push('');
  }

  // The paste-ready handoff prompt
  lines.push('## Handoff Prompt');
  lines.push('');
  lines.push('Copy and paste the block below into a fresh session:');
  lines.push('');
  lines.push('```');
  lines.push(result.handoff_prompt);
  lines.push('```');

  return lines.join('\n');
}

/** Build the paste-ready prompt string from a partial HandoffResult. */
export function buildHandoffPrompt(result: Omit<HandoffResult, 'handoff_prompt'>): string {
  const lines: string[] = [];

  lines.push(`Read the handoff at ~/.claude/projects/.../memory/ and continue work.`);
  lines.push('');
  lines.push(`Branch: ${result.branch}`);
  lines.push(`Last commit: ${result.last_commit}`);
  lines.push('');

  if (result.uncommitted_changes) {
    lines.push('Uncommitted changes:');
    lines.push(result.uncommitted_changes);
    lines.push('');
  }

  if (result.recent_commits.length > 0) {
    lines.push('Recent commits:');
    for (const c of result.recent_commits.slice(0, 5)) {
      lines.push(`  ${c}`);
    }
    lines.push('');
  }

  if (result.remaining_work.length > 0) {
    lines.push('Remaining work:');
    for (const w of result.remaining_work) {
      lines.push(`  - ${w}`);
    }
    lines.push('');
  }

  const incompleteTodos = result.todos.filter(t => t.status !== 'completed');
  if (incompleteTodos.length > 0) {
    lines.push('Incomplete tasks from previous session:');
    for (const t of incompleteTodos) {
      const prefix = t.status === 'in_progress' ? '[in progress]' : '[pending]';
      lines.push(`  - ${prefix} ${t.content}`);
    }
    lines.push('');
  }

  lines.push('Pick up where the previous session left off.');

  return lines.join('\n');
}
