/**
 * plugin.ts — CLI command: plugin management.
 *
 * Wraps PluginRegistry for listing, searching, and installing plugins.
 */

import { CommandDefinition, ParsedArgs, output, isJson, table } from '../parser';
import { PluginRegistry } from '../../plugins/registry';

export const pluginCommand: CommandDefinition = {
  name: 'plugin',
  description: 'List, search, and install plugins',
  usage: [
    'Usage: agent-sentry plugin <subcommand> [options]',
    '',
    'Subcommands:',
    '  list              List installed plugins',
    '  search <query>    Search available plugins',
    '  install <path>    Install a plugin from a local path',
    '  enable <name>     Enable an installed plugin',
    '  disable <name>    Disable an installed plugin',
    '  info <name>       Show plugin details',
    '',
    'Options:',
    '  --category <cat>  Filter by category (monitor, integration, dashboard, auditor)',
    '  --tag <tag>       Filter by tag',
    '  --json            Output in JSON format',
  ].join('\n'),

  async run(args: ParsedArgs): Promise<void> {
    const sub = args.positionals[0];
    const json = isJson(args.flags);

    if (!sub) {
      process.stderr.write('Usage: agent-sentry plugin <list|search|install|enable|disable|info>\n');
      process.exitCode = 1;
      return;
    }

    const registry = new PluginRegistry();

    if (sub === 'list') {
      const installed = await registry.list();
      if (json) {
        output(installed, true);
      } else if (installed.length === 0) {
        output('No plugins installed.', false);
      } else {
        table(installed.map((p) => ({
          name: p.manifest.name,
          version: p.manifest.version,
          category: p.manifest.category,
          enabled: p.enabled ? 'yes' : 'no',
          source: p.source,
        })));
      }
      return;
    }

    if (sub === 'search') {
      const query = args.positionals.slice(1).join(' ') || undefined;
      const category = typeof args.flags['category'] === 'string' ? args.flags['category'] : undefined;
      const tags = typeof args.flags['tag'] === 'string' ? [args.flags['tag']] : undefined;

      const results = await registry.list({ query, category, tags });
      if (json) {
        output(results, true);
      } else if (results.length === 0) {
        output('No plugins found.', false);
      } else {
        table(results.map((p) => ({
          name: p.manifest.name,
          version: p.manifest.version,
          category: p.manifest.category,
          description: p.manifest.description.slice(0, 50),
        })));
      }
      return;
    }

    if (sub === 'install') {
      const sourcePath = args.positionals[1];
      if (!sourcePath) {
        process.stderr.write('Usage: agent-sentry plugin install <path>\n');
        process.exitCode = 1;
        return;
      }
      const result = await registry.install(sourcePath);
      output(json ? result : `Installed: ${result.manifest.name} v${result.manifest.version}`, json);
      return;
    }

    if (sub === 'enable') {
      const name = args.positionals[1];
      if (!name) { process.stderr.write('Usage: agent-sentry plugin enable <name>\n'); process.exitCode = 1; return; }
      const ok = await registry.enable(name);
      if (!ok) { process.stderr.write(`Plugin not found: ${name}\n`); process.exitCode = 1; return; }
      output(json ? { enabled: name } : `Enabled: ${name}`, json);
      return;
    }

    if (sub === 'disable') {
      const name = args.positionals[1];
      if (!name) { process.stderr.write('Usage: agent-sentry plugin disable <name>\n'); process.exitCode = 1; return; }
      const ok = await registry.disable(name);
      if (!ok) { process.stderr.write(`Plugin not found: ${name}\n`); process.exitCode = 1; return; }
      output(json ? { disabled: name } : `Disabled: ${name}`, json);
      return;
    }

    if (sub === 'info') {
      const name = args.positionals[1];
      if (!name) { process.stderr.write('Usage: agent-sentry plugin info <name>\n'); process.exitCode = 1; return; }
      const info = await registry.get(name);
      if (!info) {
        process.stderr.write(`Plugin not found: ${name}\n`);
        process.exitCode = 1;
        return;
      }
      output(info, json);
      return;
    }

    process.stderr.write(`Unknown plugin subcommand: ${sub}\n`);
    process.exitCode = 1;
  },
};
