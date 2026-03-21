/**
 * memory.ts — CLI command: memory store operations.
 *
 * Wraps MemoryStore for search, stats, and event listing.
 */

import { CommandDefinition, ParsedArgs, output, isJson, table } from '../parser';
import { MemoryStore } from '../../memory/store';

async function getStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.initialize();
  return store;
}

export const memoryCommand: CommandDefinition = {
  name: 'memory',
  description: 'Search, list, and inspect stored events',
  usage: [
    'Usage: agentops memory <subcommand> [options]',
    '',
    'Subcommands:',
    '  search <query>   Semantic search across events',
    '  list             List recent events',
    '  stats            Show store statistics',
    '  verify           Verify hash chain integrity',
    '',
    'Options:',
    '  --limit <n>      Maximum results (default 10)',
    '  --type <type>    Filter by event type',
    '  --severity <s>   Filter by severity',
    '  --json           Output in JSON format',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const sub = args.positionals[0];
    const json = isJson(args.flags);

    if (!sub) {
      process.stderr.write('Usage: agentops memory <search|list|stats|verify>\n');
      process.exitCode = 1;
      return;
    }

    const store = await getStore();

    if (sub === 'search') {
      const query = args.positionals.slice(1).join(' ');
      if (!query) {
        process.stderr.write('Usage: agentops memory search <query>\n');
        process.exitCode = 1;
        return;
      }

      const limit = typeof args.flags['limit'] === 'string' ? parseInt(args.flags['limit'], 10) : 10;
      const event_type = typeof args.flags['type'] === 'string' ? args.flags['type'] as any : undefined;
      const severity = typeof args.flags['severity'] === 'string' ? args.flags['severity'] as any : undefined;

      const results = await store.search(query, { limit, event_type, severity });

      if (json) {
        output(results, true);
      } else if (results.length === 0) {
        output('No matching events found.', false);
      } else {
        table(results.map((r) => ({
          score: r.score.toFixed(3),
          type: r.event.event_type,
          severity: r.event.severity,
          title: r.event.title.slice(0, 60),
          timestamp: r.event.timestamp,
        })));
      }
      return;
    }

    if (sub === 'list') {
      const limit = typeof args.flags['limit'] === 'string' ? parseInt(args.flags['limit'], 10) : 20;
      const event_type = typeof args.flags['type'] === 'string' ? args.flags['type'] as any : undefined;
      const severity = typeof args.flags['severity'] === 'string' ? args.flags['severity'] as any : undefined;

      const events = await store.list({ limit, event_type, severity });

      if (json) {
        output(events, true);
      } else if (events.length === 0) {
        output('No events found.', false);
      } else {
        table(events.map((e) => ({
          id: e.id.slice(0, 8),
          type: e.event_type,
          severity: e.severity,
          title: e.title.slice(0, 50),
          timestamp: e.timestamp,
        })));
      }
      return;
    }

    if (sub === 'stats') {
      const stats = await store.stats();
      if (json) {
        output(stats, true);
      } else {
        output(`Total events: ${stats.total_events}`, false);
        output(`Types: ${Object.entries(stats.by_type).map(([k, v]) => `${k}=${v}`).join(', ')}`, false);
        output(`Severities: ${Object.entries(stats.by_severity).map(([k, v]) => `${k}=${v}`).join(', ')}`, false);
        output(`Skills: ${Object.entries(stats.by_skill).map(([k, v]) => `${k}=${v}`).join(', ')}`, false);
        if (stats.first_event) output(`Oldest: ${stats.first_event}`, false);
        if (stats.last_event) output(`Newest: ${stats.last_event}`, false);
      }
      return;
    }

    if (sub === 'verify') {
      const result = await store.verifyChain();
      if (json) {
        output(result, true);
      } else {
        const icon = result.valid ? '✓' : '✗';
        output(`${icon} Chain ${result.valid ? 'valid' : 'BROKEN'}  (${result.total_checked} checked)`, false);
        if (result.first_broken_at) {
          output(`First break at: ${result.first_broken_at}`, false);
        }
        if (result.broken_event_id) {
          output(`Broken event: ${result.broken_event_id}`, false);
        }
      }
      return;
    }

    process.stderr.write(`Unknown memory subcommand: ${sub}\n`);
    process.exitCode = 1;
  },
};
