/**
 * prune.ts — CLI command: prune old events from the memory store.
 *
 * Removes events exceeding max count or age thresholds.
 */

import { CommandDefinition, ParsedArgs, output, isJson } from '../parser';
import { MemoryStore } from '../../memory/store';

async function getStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.initialize();
  return store;
}

export const pruneCommand: CommandDefinition = {
  name: 'prune',
  description: 'Remove old events from the memory store',
  usage: [
    'Usage: agent-sentry prune [options]',
    '',
    'Options:',
    '  --max-events <n>     Maximum events to keep (default: from config or 100000)',
    '  --max-age-days <n>   Maximum age in days (default: from config or 365)',
    '  --dry-run            Show what would be deleted without deleting',
    '  --json               Output in JSON format',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const json = isJson(args.flags);
    const maxEvents = typeof args.flags['max-events'] === 'string'
      ? parseInt(args.flags['max-events'], 10)
      : undefined;
    const maxAgeDays = typeof args.flags['max-age-days'] === 'string'
      ? parseInt(args.flags['max-age-days'], 10)
      : undefined;
    const dryRun = args.flags['dry-run'] === true;

    const store = await getStore();

    try {
      if (dryRun) {
        const stats = await store.stats();
        const total = stats.total_events;
        const effectiveMax = maxEvents ?? 100000;
        const overLimit = Math.max(0, total - effectiveMax);

        // For age-based pruning, we can only estimate from stats
        const result = { total_events: total, would_delete_over_limit: overLimit, max_events: effectiveMax, max_age_days: maxAgeDays ?? 365 };

        if (json) {
          output(result, true);
        } else {
          output(`Dry run — no events deleted`, false);
          output(`Total events: ${total}`, false);
          output(`Max events limit: ${effectiveMax}`, false);
          output(`Events over limit: ${overLimit}`, false);
          output(`Max age: ${maxAgeDays ?? 365} days`, false);
        }
      } else {
        const result = await store.prune({ maxEvents, maxAgeDays });

        if (json) {
          output(result, true);
        } else {
          output(`Pruned ${result.deleted} event(s).`, false);
        }
      }
    } finally {
      await store.close();
    }
  },
};
