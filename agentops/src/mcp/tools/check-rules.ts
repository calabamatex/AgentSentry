/**
 * check-rules.ts — agent_sentry_check_rules tool: delegates to rules-validation primitive.
 */

import { z } from 'zod';
import { validateRules } from '../../primitives/rules-validation';

export const name = 'agentops_check_rules';
export const description =
  'Check a proposed file change against CLAUDE.md and AGENTS.md rules. Reports violations.';

export const inputSchema = {
  type: 'object' as const,
  properties: {
    file_path: {
      type: 'string',
      description: 'Path of the file being changed',
    },
    change_description: {
      type: 'string',
      description: 'Description of the proposed change',
    },
  },
  required: ['file_path', 'change_description'],
};

export const argsSchema = z.object({
  file_path: z.string(),
  change_description: z.string(),
});

export async function handler(
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const parsed = argsSchema.parse(args);
    const result = await validateRules(parsed.file_path, parsed.change_description);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          violations: result.violations,
          compliant: result.compliant,
          rules_checked: result.rulesChecked,
        }, null, 2),
      }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    };
  }
}
