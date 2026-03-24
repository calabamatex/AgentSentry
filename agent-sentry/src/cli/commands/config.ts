/**
 * config.ts — CLI command: configuration management.
 *
 * Reads/writes agent-sentry.config.json via the provider-factory loader.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CommandDefinition, ParsedArgs, output, isJson, table } from '../parser';
import { loadMemoryConfig } from '../../memory/providers/provider-factory';
import { resolveConfigPath } from '../../config/resolve';
import { Logger } from '../../observability/logger';

const logger = new Logger({ module: 'cli-config' });

const DEFAULT_CONFIG_PATH = path.resolve('agent-sentry/agent-sentry.config.json');

function getConfigPath(): string {
  return resolveConfigPath() ?? DEFAULT_CONFIG_PATH;
}

export const configCommand: CommandDefinition = {
  name: 'config',
  description: 'View and modify AgentSentry configuration',
  usage: [
    'Usage: agent-sentry config <subcommand> [options]',
    '',
    'Subcommands:',
    '  show               Show current configuration',
    '  get <key>          Get a specific config value',
    '  set <key> <value>  Set a config value',
    '  path               Show config file path',
    '',
    'Options:',
    '  --json             Output in JSON format',
    '',
    'Keys (dot-separated): memory.provider, memory.database_path, etc.',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const sub = args.positionals[0] ?? 'show';
    const json = isJson(args.flags);

    if (sub === 'show') {
      const config = loadFullConfig();
      if (json) {
        output(config, true);
      } else {
        const memCfg = loadMemoryConfig();
        const rows = Object.entries(memCfg).map(([key, value]) => ({
          key: `memory.${key}`,
          value: String(value),
        }));
        table(rows, ['key', 'value']);
      }
      return;
    }

    if (sub === 'get') {
      const key = args.positionals[1];
      if (!key) {
        process.stderr.write('Usage: agent-sentry config get <key>\n');
        process.exitCode = 1;
        return;
      }

      const config = loadFullConfig();
      const value = getNestedValue(config, key);
      if (value === undefined) {
        process.stderr.write(`Key not found: ${key}\n`);
        process.exitCode = 1;
        return;
      }
      output(json ? { key, value } : String(value), json);
      return;
    }

    if (sub === 'set') {
      const key = args.positionals[1];
      const value = args.positionals[2];
      if (!key || value === undefined) {
        process.stderr.write('Usage: agent-sentry config set <key> <value>\n');
        process.exitCode = 1;
        return;
      }

      const config = loadFullConfig();
      setNestedValue(config, key, parseValue(value));
      saveConfig(config);
      output(json ? { key, value: parseValue(value), saved: true } : `Set ${key} = ${value}`, json);
      return;
    }

    if (sub === 'path') {
      const resolvedPath = getConfigPath();
      output(json ? { path: resolvedPath } : resolvedPath, json);
      return;
    }

    process.stderr.write(`Unknown config subcommand: ${sub}\n`);
    process.exitCode = 1;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFullConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
  } catch (e) {
    logger.debug('Failed to load config file', { error: e instanceof Error ? e.message : String(e) });
    return { memory: {} };
  }
}

function saveConfig(config: Record<string, unknown>): void {
  const cfgPath = getConfigPath();
  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== '') return num;
  return raw;
}
