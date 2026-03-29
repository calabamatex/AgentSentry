#!/usr/bin/env node
/**
 * index.ts — AgentSentry CLI entry point.
 *
 * Dispatches subcommands to their handlers. Zero external dependencies.
 * Usage: agent-sentry <command> [options]
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
import { enableCommand } from './commands/enable';
import { initCommand } from './commands/init';
import { handoffCommand } from './commands/handoff';
import { pruneCommand } from './commands/prune';
import { exportCommand } from './commands/export';
import { importCommand } from './commands/import';

// ---------------------------------------------------------------------------
// Version — single source of truth from package.json
// ---------------------------------------------------------------------------

import { VERSION } from '../version';

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

const commands: CommandDefinition[] = [
  initCommand,
  handoffCommand,
  healthCommand,
  metricsCommand,
  memoryCommand,
  streamCommand,
  pluginCommand,
  configCommand,
  dashboardCommand,
  enableCommand,
  pruneCommand,
  exportCommand,
  importCommand,
];

const commandMap = new Map(commands.map((c) => [c.name, c]));

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  const lines = [
    `agent-sentry v${VERSION} — CLI for AgentSentry agent management`,
    '',
    'Usage: agent-sentry <command> [options]',
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
    '  agent-sentry init',
    '  agent-sentry init --level 2',
    '  agent-sentry health',
    '  agent-sentry metrics --json',
    '  agent-sentry memory search "auth patterns"',
    '  agent-sentry stream --filter type=error',
    '  agent-sentry plugin list',
    '  agent-sentry config show',
    '  agent-sentry dashboard --port 9200',
    '  agent-sentry enable --level 1',
    '  agent-sentry handoff',
    '  agent-sentry handoff --save',
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
      process.stdout.write(`agent-sentry ${cmd.name} — ${cmd.description}\n`);
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

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
