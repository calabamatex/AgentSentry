/**
 * Monitor Plugin Template
 *
 * Observes agent activity and captures events for analysis.
 */

export const name = 'my-monitor-plugin';
export const version = '1.0.0';
export const category = 'monitor' as const;

export const hooks = ['PostToolUse', 'SessionStart'] as const;

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

let active = false;

/**
 * Activates the monitor plugin.
 * Called when the plugin is loaded by the AgentSentry runtime.
 */
export async function activate(context: PluginContext): Promise<void> {
  active = true;
  console.log(`[${name}] Activated for session ${context.sessionId}`);
}

/**
 * Deactivates the monitor plugin.
 * Called when the plugin is unloaded or the session ends.
 */
export async function deactivate(): Promise<void> {
  active = false;
  console.log(`[${name}] Deactivated`);
}

/**
 * Handles a lifecycle hook event.
 */
export async function onHook(event: HookEvent): Promise<void> {
  if (!active) return;

  switch (event.hook) {
    case 'SessionStart':
      console.log(`[${name}] Session started at ${event.timestamp}`);
      break;
    case 'PostToolUse':
      console.log(`[${name}] Tool used: ${event.tool} at ${event.timestamp}`);
      break;
    default:
      break;
  }
}
