/**
 * import.ts — CLI command: import events into the memory store.
 *
 * Reads events from a JSON or NDJSON file and inserts them via store.capture().
 */

import * as fs from 'fs';
import * as path from 'path';
import { CommandDefinition, ParsedArgs, output, isJson } from '../parser';
import { MemoryStore } from '../../memory/store';
import { validateEventInput, OpsEventInput } from '../../memory/schema';

async function getStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.initialize();
  return store;
}

function parseEvents(content: string, format: string): unknown[] {
  if (format === 'ndjson') {
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`Invalid JSON on line ${i + 1}`);
        }
      });
  }
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error('JSON input must be an array of events');
  }
  return parsed;
}

export const importCommand: CommandDefinition = {
  name: 'import',
  description: 'Import events from a JSON or NDJSON file',
  usage: [
    'Usage: agent-sentry import <file> [options]',
    '',
    'Options:',
    '  --format <fmt>   Input format: json or ndjson (default: json)',
    '  --json           Output results in JSON format',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const json = isJson(args.flags);
    const file = args.positionals[0];

    if (!file) {
      process.stderr.write('Usage: agent-sentry import <file> [--format json|ndjson]\n');
      process.exitCode = 1;
      return;
    }

    const format = typeof args.flags['format'] === 'string' ? args.flags['format'] : 'json';
    if (format !== 'json' && format !== 'ndjson') {
      process.stderr.write(`Unknown format: ${format}. Use "json" or "ndjson".\n`);
      process.exitCode = 1;
      return;
    }

    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`File not found: ${resolved}\n`);
      process.exitCode = 1;
      return;
    }

    const store = await getStore();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const rawEvents = parseEvents(content, format);

      for (let i = 0; i < rawEvents.length; i++) {
        const raw = rawEvents[i] as OpsEventInput;
        const validationErrors = validateEventInput(raw);

        if (validationErrors.length > 0) {
          skipped++;
          errors.push(`Event ${i + 1}: ${validationErrors.join(', ')}`);
          continue;
        }

        try {
          await store.capture(raw);
          imported++;
        } catch (err) {
          skipped++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`Event ${i + 1}: ${msg}`);
        }
      }

      const result = { imported, skipped, errors };

      if (json) {
        output(result, true);
      } else {
        output(`Imported: ${imported}, Skipped: ${skipped}`, false);
        for (const e of errors) {
          process.stderr.write(`  Warning: ${e}\n`);
        }
      }
    } finally {
      await store.close();
    }
  },
};
