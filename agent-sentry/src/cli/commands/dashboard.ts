/**
 * dashboard.ts — CLI command: start the real-time dashboard server.
 *
 * Wraps DashboardServer to serve the v5 SPA with live SSE events.
 */

import { CommandDefinition, ParsedArgs, output, isJson } from '../parser';
import { DashboardServer } from '../../dashboard/server';

export const dashboardCommand: CommandDefinition = {
  name: 'dashboard',
  description: 'Start the real-time web dashboard',
  usage: [
    'Usage: agent-sentry dashboard [options]',
    '',
    'Options:',
    '  --port <n>       Port to listen on (default 9200)',
    '  --host <addr>    Host to bind to (default 127.0.0.1)',
    '  --json           Output server info as JSON',
    '',
    'Press Ctrl+C to stop.',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const json = isJson(args.flags);
    const port = typeof args.flags['port'] === 'string' ? parseInt(args.flags['port'], 10) : 9200;
    const host = typeof args.flags['host'] === 'string' ? args.flags['host'] : '127.0.0.1';

    const server = new DashboardServer({ port, host });

    const info = await server.start();

    if (json) {
      output(info, true);
    } else {
      output(`Dashboard running at ${info.url}`, false);
      output('Press Ctrl+C to stop.', false);
    }

    // Clean shutdown
    const cleanup = (): void => {
      void server.stop().then(() => {
        process.stdout.write('\nDashboard stopped.\n');
        process.exit(0);
      });
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Keep process alive
    const keepAlive = setInterval(() => {}, 60_000);
    process.on('beforeExit', () => {
      clearInterval(keepAlive);
      void server.stop();
    });
  },
};
