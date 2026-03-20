/**
 * Dashboard Plugin Template
 *
 * Aggregates and visualizes agent operational data.
 */

export const name = 'my-dashboard-plugin';
export const version = '1.0.0';
export const category = 'dashboard' as const;

export const hooks = ['SessionStart', 'Stop'] as const;

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

export interface DashboardState {
  startTime: string;
  eventCount: number;
  lastUpdate: string;
}

let active = false;
let state: DashboardState | null = null;

/**
 * Activates the dashboard plugin.
 */
export async function activate(context: PluginContext): Promise<void> {
  active = true;
  state = {
    startTime: new Date().toISOString(),
    eventCount: 0,
    lastUpdate: new Date().toISOString(),
  };
  console.log(`[${name}] Activated for session ${context.sessionId}`);
}

/**
 * Deactivates the dashboard plugin and outputs final summary.
 */
export async function deactivate(): Promise<void> {
  if (state) {
    console.log(`[${name}] Session summary: ${state.eventCount} events tracked`);
  }
  active = false;
  state = null;
  console.log(`[${name}] Deactivated`);
}

/**
 * Handles a lifecycle hook event.
 */
export async function onHook(event: HookEvent): Promise<void> {
  if (!active || !state) return;

  state.eventCount++;
  state.lastUpdate = event.timestamp;

  switch (event.hook) {
    case 'SessionStart':
      console.log(`[${name}] Dashboard initialized at ${event.timestamp}`);
      break;
    case 'Stop':
      console.log(`[${name}] Session ending. Total events: ${state.eventCount}`);
      break;
    default:
      break;
  }
}
