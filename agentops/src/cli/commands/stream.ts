/**
 * stream.ts — CLI command: real-time event stream tail.
 *
 * Wraps EventStream with a callback transport that writes to stdout.
 * Handles stdout backpressure and clean SIGINT teardown.
 */

import { CommandDefinition, ParsedArgs } from '../parser';
import { EventStream, StreamFilter, StreamEvent } from '../../streaming/event-stream';

export const streamCommand: CommandDefinition = {
  name: 'stream',
  description: 'Tail live event stream to stdout',
  usage: [
    'Usage: agentops stream [options]',
    '',
    'Options:',
    '  --filter <key=value>   Filter events (type, severity, skill, agent, session)',
    '  --json                 Output events as JSON lines (default)',
    '  --pretty               Pretty-print events (human-readable)',
    '',
    'Press Ctrl+C to stop.',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const json = !args.flags['pretty'];

    // Build filter from --filter flags
    const filter = buildFilter(args);

    const eventStream = new EventStream();
    eventStream.start();

    // Track whether stdout is writable (backpressure handling)
    let draining = true;
    process.stdout.on('drain', () => { draining = true; });

    const clientId = `cli-${Date.now()}`;

    eventStream.addClient({
      id: clientId,
      connectedAt: new Date().toISOString(),
      filter,
      transport: 'callback',
      send(event: StreamEvent): void {
        if (event.type === 'heartbeat') return; // suppress heartbeats in CLI

        const line = json
          ? JSON.stringify(event)
          : formatEvent(event);

        if (draining) {
          draining = process.stdout.write(line + '\n');
        }
        // If stdout is full, drop the event (tail semantics — latest wins)
      },
      close(): void {
        // No-op for stdout
      },
    });

    // Clean SIGINT teardown
    const cleanup = (): void => {
      eventStream.removeClient(clientId);
      eventStream.stop();
      process.stdout.write('\n');
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Keep process alive
    const keepAlive = setInterval(() => {}, 60_000);

    // Handle process exit
    process.on('beforeExit', () => {
      clearInterval(keepAlive);
      eventStream.removeClient(clientId);
      eventStream.stop();
    });
  },
};

function buildFilter(args: ParsedArgs): StreamFilter {
  const filter: StreamFilter = {};
  const raw = args.flags['filter'];

  if (typeof raw === 'string') {
    applyFilterPair(filter, raw);
  }

  // Also check positionals for extra filter pairs
  for (const pos of args.positionals) {
    if (pos.includes('=')) {
      applyFilterPair(filter, pos);
    }
  }

  return filter;
}

function applyFilterPair(filter: StreamFilter, pair: string): void {
  const eqIdx = pair.indexOf('=');
  if (eqIdx === -1) return;
  const key = pair.slice(0, eqIdx);
  const val = pair.slice(eqIdx + 1);

  switch (key) {
    case 'type': (filter.eventTypes ??= []).push(val); break;
    case 'severity': (filter.severities ??= []).push(val); break;
    case 'skill': (filter.skills ??= []).push(val); break;
    case 'agent': filter.agentId = val; break;
    case 'session': filter.sessionId = val; break;
    case 'tag': (filter.tags ??= []).push(val); break;
  }
}

function formatEvent(event: StreamEvent): string {
  const ts = event.timestamp.slice(11, 23); // HH:MM:SS.mmm
  return `[${ts}] ${event.type.padEnd(12)} ${JSON.stringify(event.data)}`;
}
