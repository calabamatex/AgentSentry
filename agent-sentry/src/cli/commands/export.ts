/**
 * export.ts — CLI command: export events from the memory store.
 *
 * Exports events in JSON or NDJSON format to stdout or a file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CommandDefinition, ParsedArgs, isJson } from '../parser';
import { MemoryStore } from '../../memory/store';

async function getStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.initialize();
  return store;
}

export const exportCommand: CommandDefinition = {
  name: 'export',
  description: 'Export events to JSON or NDJSON',
  usage: [
    'Usage: agent-sentry export [options]',
    '',
    'Options:',
    '  --format <fmt>   Output format: json or ndjson (default: json)',
    '  --since <ISO>    Only events after this timestamp',
    '  --until <ISO>    Only events before this timestamp',
    '  --output <file>  Write to file instead of stdout',
    '  --json           (alias for --format json)',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const format = typeof args.flags['format'] === 'string'
      ? args.flags['format']
      : (isJson(args.flags) ? 'json' : 'json');
    const since = typeof args.flags['since'] === 'string' ? args.flags['since'] : undefined;
    const until = typeof args.flags['until'] === 'string' ? args.flags['until'] : undefined;
    const outputFile = typeof args.flags['output'] === 'string' ? args.flags['output'] : undefined;

    if (format !== 'json' && format !== 'ndjson') {
      process.stderr.write(`Unknown format: ${format}. Use "json" or "ndjson".\n`);
      process.exitCode = 1;
      return;
    }

    const store = await getStore();

    try {
      const events = await store.list({ since, until, limit: 100000 });

      let content: string;
      if (format === 'ndjson') {
        content = events.map((e) => JSON.stringify(e)).join('\n');
        if (events.length > 0) content += '\n';
      } else {
        content = JSON.stringify(events, null, 2) + '\n';
      }

      if (outputFile) {
        const resolved = path.resolve(outputFile);
        fs.writeFileSync(resolved, content, 'utf-8');
        process.stderr.write(`Exported ${events.length} event(s) as ${format} to ${resolved}\n`);
      } else {
        process.stdout.write(content);
        process.stderr.write(`Exported ${events.length} event(s) as ${format} to stdout\n`);
      }
    } finally {
      await store.close();
    }
  },
};
