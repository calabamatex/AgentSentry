#!/usr/bin/env node
/**
 * index.ts — AgentOps CLI entry point.
 *
 * Dispatches subcommands to their handlers. Zero external dependencies.
 * Usage: agentops <command> [options]
 */

import { parse, output, CommandDefinition } from './parser';

// Import commands
import { healthCommand } from './commands/health';
import { metricsCommand } from './commands/metrics';
import { memoryCommand } from './commands/memory';
import { streamCommand } from './commands/stream';
import { pluginCommand } from './commands/plugin';
import { configCommand } from './commands/config';
import { dashboardCommand } from './commands/dashboard';

// ---------------------------------------------------------------------------
// Version (read from package.json at build time is fragile — hardcode + sync)
// ---------------------------------------------------------------------------

const VERSION = '4.0.0';

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

const commands: CommandDefinition[] = [
  healthCommand,
  metricsCommand,
  memoryCommand,
  streamCommand,
  pluginCommand,
  configCommand,
  dashboardCommand,
];

const commandMap = new Map(commands.map((c) => [c.name, c]));

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  const lines = [
    `agentops v${VERSION} — CLI for AgentOps agent management`,
    '',
    'Usage: agentops <command> [options]',
    '',
    'Commands:',
    ...commands.map((c) => `  ${c.name.padEnd(12)} ${c.description}`),
    '',
    'Global flags:',
    '  --help       Show help for a command',
    '  --json       Output in JSON format',
    '  --version    Show version',
    '',
    'Examples:',
    '  agentops health',
    '  agentops metrics --json',
    '  agentops memory search "auth patterns"',
    '  agentops stream --filter type=error',
    '  agentops plugin list',
    '  agentops config show',
    '  agentops dashboard --port 9200',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parse(process.argv);

  if (args.flags['version'] === true || args.flags['v'] === true) {
    output(VERSION, false);
    return;
  }

  if (!args.command || args.flags['help'] === true || args.flags['h'] === true) {
    if (args.command && commandMap.has(args.command)) {
      const cmd = commandMap.get(args.command)!;
      process.stdout.write(`agentops ${cmd.name} — ${cmd.description}\n`);
      if (cmd.usage) {
        process.stdout.write('\n' + cmd.usage + '\n');
      }
      return;
    }
    printHelp();
    return;
  }

  const cmd = commandMap.get(args.command);
  if (!cmd) {
    process.stderr.write(`Unknown command: ${args.command}\n\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    await cmd.run(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
