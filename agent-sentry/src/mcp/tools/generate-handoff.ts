/**
 * generate-handoff.ts — MCP tool: agent_sentry_generate_handoff
 *
 * Generates a structured handoff prompt when context is critically full.
 * Called by Claude when it detects the context warning, or on demand.
 */

import { execSync } from 'child_process';
import { z } from 'zod';

export const name = 'agent_sentry_generate_handoff';
export const description =
  'Generate a structured handoff prompt for session continuity. Use when context is critically full or when ending a session.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    session_id: {
      type: 'string',
      description: 'Current session identifier (optional)',
    },
    remaining_work: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of remaining work items / next steps',
    },
    session_summary: {
      type: 'string',
      description: 'Summary of what was accomplished this session',
    },
  },
  required: [] as string[],
};

export const argsSchema = z.object({
  session_id: z.string().optional(),
  remaining_work: z.array(z.string()).optional(),
  session_summary: z.string().optional(),
});

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const parsed = argsSchema.parse(args);

    const branch = git('branch --show-current') || git('rev-parse --abbrev-ref HEAD') || 'unknown';
    const lastCommit = git('log -1 --oneline') || 'no commits';
    const uncommitted = git('status --short') || '';
    const diffStat = git('diff --stat') || '';
    const recentCommits = git('log --oneline -10').split('\n').filter(Boolean);
    const sessionId = parsed.session_id ?? `session-${Date.now()}`;
    const remaining = parsed.remaining_work ?? [];
    const summary = parsed.session_summary ?? '';

    // Build the handoff document
    const sections: string[] = [];

    sections.push('# Auto-Generated Handoff');
    sections.push('');
    sections.push(`Generated: ${new Date().toISOString()}`);
    sections.push(`Session: ${sessionId}`);
    sections.push('');
    sections.push('## Current State');
    sections.push(`- **Branch**: ${branch}`);
    sections.push(`- **Last commit**: ${lastCommit}`);

    if (summary) {
      sections.push('');
      sections.push('## Session Summary');
      sections.push(summary);
    }

    if (uncommitted) {
      sections.push('');
      sections.push('## Uncommitted Changes');
      sections.push('```');
      sections.push(uncommitted);
      sections.push('```');
    }

    if (diffStat) {
      sections.push('');
      sections.push('## Diff Stat');
      sections.push('```');
      sections.push(diffStat);
      sections.push('```');
    }

    if (recentCommits.length > 0) {
      sections.push('');
      sections.push('## Recent Commits');
      sections.push('```');
      for (const c of recentCommits) {
        sections.push(c);
      }
      sections.push('```');
    }

    if (remaining.length > 0) {
      sections.push('');
      sections.push('## Remaining Work');
      for (const item of remaining) {
        sections.push(`- ${item}`);
      }
    }

    // Build the paste-ready prompt
    sections.push('');
    sections.push('## Paste-Ready Handoff Prompt');
    sections.push('');
    sections.push('Copy the block below into a fresh session:');
    sections.push('');
    sections.push('---');
    sections.push('');

    const promptLines: string[] = [];
    promptLines.push(`Continue work on this project. Here's the handoff from the previous session:`);
    promptLines.push('');
    promptLines.push(`Branch: ${branch}`);
    promptLines.push(`Last commit: ${lastCommit}`);
    if (uncommitted) {
      promptLines.push('');
      promptLines.push('Uncommitted changes:');
      promptLines.push(uncommitted);
    }
    if (recentCommits.length > 0) {
      promptLines.push('');
      promptLines.push('Recent commits:');
      for (const c of recentCommits.slice(0, 5)) {
        promptLines.push(`  ${c}`);
      }
    }
    if (remaining.length > 0) {
      promptLines.push('');
      promptLines.push('Remaining work:');
      for (const w of remaining) {
        promptLines.push(`  - ${w}`);
      }
    }
    if (summary) {
      promptLines.push('');
      promptLines.push(`Previous session summary: ${summary}`);
    }
    promptLines.push('');
    promptLines.push('Pick up where the previous session left off.');

    sections.push(promptLines.join('\n'));

    const result = {
      session_id: sessionId,
      branch,
      last_commit: lastCommit,
      uncommitted_file_count: uncommitted.split('\n').filter(Boolean).length,
      recent_commit_count: recentCommits.length,
      remaining_work_count: remaining.length,
      handoff_document: sections.join('\n'),
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    };
  }
}
