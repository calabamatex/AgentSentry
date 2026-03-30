/**
 * Example: Creating an AgentSentry plugin.
 *
 * Plugins are directories with a metadata.json file and an entry point.
 * This example shows a simple monitor plugin that logs high-severity events.
 */

// 1. Plugin metadata (metadata.json)
const metadata = {
  name: 'high-severity-alert',
  version: '1.0.0',
  description: 'Alerts on high-severity events',
  category: 'monitor',
  author: 'Your Name',
  entry: 'index.js',
  config_schema: {
    type: 'object',
    properties: {
      threshold: {
        type: 'string',
        enum: ['medium', 'high', 'critical'],
        default: 'high',
      },
    },
  },
};

// 2. Plugin entry point (index.ts)
import { MemoryStore, createProvider } from 'agent-sentry';
import type { OpsEvent } from 'agent-sentry';

interface PluginConfig {
  threshold: 'medium' | 'high' | 'critical';
}

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

function meetsThreshold(severity: string, threshold: string): boolean {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(threshold);
}

/**
 * Plugin activation function.
 * Called by the plugin registry when the plugin is loaded.
 */
export async function activate(store: MemoryStore, config: PluginConfig) {
  const threshold = config.threshold ?? 'high';

  console.log(`[high-severity-alert] Monitoring for ${threshold}+ events`);

  // Example: poll for recent high-severity events every 60 seconds
  const interval = setInterval(async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    const events = await store.list({ since, limit: 100 });

    const alerts = events.filter((e: OpsEvent) =>
      meetsThreshold(e.severity, threshold),
    );

    for (const event of alerts) {
      console.log(
        `[ALERT] ${event.severity.toUpperCase()}: ${event.title}`,
        `(${event.event_type}, ${event.skill})`,
      );
    }
  }, 60_000);

  // Return a deactivate function
  return {
    deactivate() {
      clearInterval(interval);
      console.log('[high-severity-alert] Plugin deactivated');
    },
  };
}

// 3. Directory structure:
//
//   plugins/community/high-severity-alert/
//     metadata.json
//     index.ts
//     README.md
//
// 4. Install with CLI:
//
//   npx agentsentry plugin install ./plugins/community/high-severity-alert
//
// See docs/plugin-tutorial.md for the full guide.
