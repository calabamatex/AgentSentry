/**
 * check-context.ts — agent_sentry_check_context tool: Estimate context window usage.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const name = 'agent_sentry_check_context';
export const description =
  'Estimate context window usage based on message count and recommend whether to continue, proceed with caution, or refresh.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    message_count: {
      type: 'number',
      description: 'Number of messages in the current conversation',
    },
  },
  required: [] as string[],
};

export const argsSchema = z.object({
  message_count: z.number().optional(),
});

const TOKENS_PER_MESSAGE = 4000;
const MAX_CONTEXT_TOKENS = 200000;

export interface CheckContextResult {
  estimated_tokens: number;
  percent_used: number;
  messages: number;
  message_count_source: 'provided' | 'state_file';
  recommendation: 'continue' | 'caution' | 'refresh';
}

function readMessageCountFromState(): number {
  const stateDir = path.join(os.tmpdir(), 'agent-sentry');
  const stateFile = path.join(stateDir, 'context-state');
  try {
    const content = fs.readFileSync(stateFile, 'utf8');
    const match = content.match(/message_count=(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch {
    // State file absent (fresh session or state cleared) — treat as 0
  }
  return 0;
}

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const parsed = argsSchema.parse(args);
    // Use explicitly-provided count, or fall back to shared state file.
    const messages = parsed.message_count ?? readMessageCountFromState();
    const message_count_source: 'provided' | 'state_file' =
      parsed.message_count !== undefined ? 'provided' : 'state_file';
    const estimated_tokens = messages * TOKENS_PER_MESSAGE;
    const percent_used = Math.min(
      100,
      Math.round((estimated_tokens / MAX_CONTEXT_TOKENS) * 10000) / 100,
    );

    let recommendation: 'continue' | 'caution' | 'refresh';
    if (percent_used < 50) {
      recommendation = 'continue';
    } else if (percent_used < 80) {
      recommendation = 'caution';
    } else {
      recommendation = 'refresh';
    }

    const result: CheckContextResult = {
      estimated_tokens,
      percent_used,
      messages,
      message_count_source,
      recommendation,
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
