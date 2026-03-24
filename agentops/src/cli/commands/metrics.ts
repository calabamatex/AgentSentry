/**
 * metrics.ts — CLI command: metrics display.
 *
 * Wraps MetricsCollector from observability module.
 */

import { CommandDefinition, ParsedArgs, output, isJson } from '../parser';
import { MetricsCollector } from '../../observability/metrics';

export const metricsCommand: CommandDefinition = {
  name: 'metrics',
  description: 'Display collected metrics',
  usage: [
    'Usage: agent-sentry metrics [subcommand] [options]',
    '',
    'Subcommands:',
    '  show       Show all metrics in Prometheus text format (default)',
    '  reset      Reset all collected metrics',
    '',
    'Options:',
    '  --json     Output metrics as JSON',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const sub = args.positionals[0] ?? 'show';
    const json = isJson(args.flags);
    const collector = MetricsCollector.getInstance();

    if (sub === 'show') {
      if (json) {
        // Expose raw Prometheus text as a JSON wrapper
        const text = collector.toPrometheus();
        output({ format: 'prometheus', text, timestamp: new Date().toISOString() }, true);
      } else {
        const text = collector.toPrometheus();
        if (text.trim().length === 0) {
          output('No metrics collected yet.', false);
        } else {
          process.stdout.write(text);
        }
      }
      return;
    }

    if (sub === 'reset') {
      MetricsCollector.reset();
      output(json ? { reset: true } : 'Metrics reset.', json);
      return;
    }

    process.stderr.write(`Unknown metrics subcommand: ${sub}\n`);
    process.exitCode = 1;
  },
};
