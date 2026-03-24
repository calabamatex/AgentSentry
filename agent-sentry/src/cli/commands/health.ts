/**
 * health.ts — CLI command: health / readiness checks.
 *
 * Wraps HealthChecker from observability module.
 */

import { CommandDefinition, ParsedArgs, output, isJson, table } from '../parser';
import { HealthChecker, memoryUsageCheck, eventLoopCheck } from '../../observability/health';
import { VERSION } from '../../version';

export const healthCommand: CommandDefinition = {
  name: 'health',
  description: 'Show health and readiness status',
  usage: [
    'Usage: agent-sentry health [subcommand] [options]',
    '',
    'Subcommands:',
    '  live       Liveness probe (is the process running?)',
    '  ready      Readiness probe (are all checks passing?)',
    '  (default)  Same as ready',
    '',
    'Options:',
    '  --json     Output in JSON format',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const sub = args.positionals[0] ?? 'ready';
    const json = isJson(args.flags);

    const checker = new HealthChecker({ version: VERSION });
    checker.registerCheck('memory', memoryUsageCheck());
    checker.registerCheck('event_loop', eventLoopCheck());

    if (sub === 'live') {
      const result = await checker.liveness();
      if (json) {
        output(result, true);
      } else {
        output(`Status: ${result.status}  Uptime: ${result.uptime.toFixed(1)}s`, false);
      }
      return;
    }

    if (sub === 'ready') {
      const result = await checker.readiness();
      if (json) {
        output(result, true);
      } else {
        const statusIcon = result.status === 'healthy' ? '●' : result.status === 'degraded' ? '◐' : '○';
        output(`${statusIcon} ${result.status.toUpperCase()}  (v${result.version}, uptime ${result.uptime.toFixed(1)}s)`, false);
        const rows = Object.entries(result.checks).map(([name, check]) => ({
          component: name,
          status: check.status,
          latency: check.latencyMs !== undefined ? `${check.latencyMs}ms` : '-',
          message: check.message ?? '',
        }));
        if (rows.length > 0) {
          process.stdout.write('\n');
          table(rows);
        }
      }
      return;
    }

    process.stderr.write(`Unknown health subcommand: ${sub}\n`);
    process.exitCode = 1;
  },
};
