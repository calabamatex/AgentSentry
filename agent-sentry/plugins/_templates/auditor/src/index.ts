/**
 * Auditor Plugin Template
 *
 * Validates agent actions against project rules and security policies.
 */

export const name = 'my-auditor-plugin';
export const version = '1.0.0';
export const category = 'auditor' as const;

export const hooks = ['PreToolUse', 'PostToolUse'] as const;

export interface PluginContext {
  sessionId: string;
  agentId: string;
  [key: string]: unknown;
}

export interface HookEvent {
  hook: string;
  tool?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface AuditResult {
  allowed: boolean;
  violations: string[];
  riskLevel?: string;
}

let active = false;

/**
 * Activates the auditor plugin.
 */
export async function activate(context: PluginContext): Promise<void> {
  active = true;
  console.log(`[${name}] Activated for session ${context.sessionId}`);
}

/**
 * Deactivates the auditor plugin.
 */
export async function deactivate(): Promise<void> {
  active = false;
  console.log(`[${name}] Deactivated`);
}

/**
 * Handles a lifecycle hook event.
 * For PreToolUse, returns an audit result that can gate execution.
 */
export async function onHook(event: HookEvent): Promise<AuditResult | void> {
  if (!active) return;

  switch (event.hook) {
    case 'PreToolUse':
      console.log(`[${name}] Auditing tool: ${event.tool}`);
      return { allowed: true, violations: [] };
    case 'PostToolUse':
      console.log(`[${name}] Post-audit for: ${event.tool}`);
      break;
    default:
      break;
  }
}
