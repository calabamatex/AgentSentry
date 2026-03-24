/**
 * Integration Plugin Template
 *
 * Connects AgentSentry with external services via MCP.
 */

export const name = 'my-integration-plugin';
export const version = '1.0.0';
export const category = 'integration' as const;

export const hooks = ['PreToolUse', 'PostToolUse', 'SessionStart', 'Stop'] as const;

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
let connected = false;

/**
 * Activates the integration plugin and connects to the external service.
 */
export async function activate(context: PluginContext): Promise<void> {
  active = true;
  // Connect to external service here
  connected = true;
  console.log(`[${name}] Activated and connected for session ${context.sessionId}`);
}

/**
 * Deactivates the integration plugin and disconnects.
 */
export async function deactivate(): Promise<void> {
  // Flush pending data and disconnect
  connected = false;
  active = false;
  console.log(`[${name}] Disconnected and deactivated`);
}

/**
 * Handles a lifecycle hook event.
 */
export async function onHook(event: HookEvent): Promise<void> {
  if (!active || !connected) return;

  switch (event.hook) {
    case 'SessionStart':
      console.log(`[${name}] Session started, syncing initial state`);
      break;
    case 'PreToolUse':
      console.log(`[${name}] Pre-sync for tool: ${event.tool}`);
      break;
    case 'PostToolUse':
      console.log(`[${name}] Post-sync for tool: ${event.tool}`);
      break;
    case 'Stop':
      console.log(`[${name}] Flushing pending data before shutdown`);
      break;
    default:
      break;
  }
}
