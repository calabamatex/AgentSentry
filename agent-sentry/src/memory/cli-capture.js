#!/usr/bin/env node
/**
 * cli-capture.js — CLI entry for shell hook integration.
 * Used by hook scripts to write events to the memory store.
 *
 * Usage:
 *   node agent-sentry/src/memory/cli-capture.js \
 *     --type decision \
 *     --severity low \
 *     --skill save_points \
 *     --title "Auto-committed files" \
 *     --detail "Auto-committed 7 files before modification" \
 *     --files "src/auth.ts,src/db.ts" \
 *     --tags "auto-commit,save-point"
 */

const path = require('path');
const fs = require('fs');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`Usage: cli-capture.js --type <type> --severity <sev> --skill <skill> --title <title> --detail <detail> [--files <csv>] [--tags <csv>] [--session <id>] [--agent <id>]`);
    process.exit(0);
  }

  // Load config to check if memory is enabled
  // Inline config resolution (mirrors src/config/resolve.ts for .js compatibility)
  let configPath;
  const envCfg = process.env.AGENT_SENTRY_CONFIG;
  if (envCfg && fs.existsSync(envCfg)) {
    configPath = path.resolve(envCfg);
  } else if (fs.existsSync(path.resolve('agent-sentry.config.json'))) {
    configPath = path.resolve('agent-sentry.config.json');
  } else if (fs.existsSync(path.resolve('agent-sentry/agent-sentry.config.json'))) {
    configPath = path.resolve('agent-sentry/agent-sentry.config.json');
  } else {
    const pkgRelative = path.join(__dirname, '..', '..', 'agent-sentry.config.json');
    if (fs.existsSync(pkgRelative)) {
      configPath = path.resolve(pkgRelative);
    }
  }

  let config = {};
  if (configPath) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      // Config unreadable — use defaults
    }
  }

  // Global kill switch: top-level "enabled": false disables all of AgentSentry
  if (config.enabled === false) {
    process.exit(0);
  }

  if (config.memory && config.memory.enabled === false) {
    process.exit(0);
  }

  // Dynamic import of compiled store
  let MemoryStore;
  try {
    const storeMod = require('../../dist/src/memory/store');
    MemoryStore = storeMod.MemoryStore;
  } catch {
    // TypeScript not compiled yet — try ts-node or skip silently
    try {
      require('ts-node/register');
      const storeMod = require('./store');
      MemoryStore = storeMod.MemoryStore;
    } catch {
      console.error('[AgentSentry] Memory store not available. Run `npm run build` first.');
      process.exit(1);
    }
  }

  const store = new MemoryStore();
  try {
    await store.initialize();
    await store.capture({
      timestamp: new Date().toISOString(),
      session_id: args.session || process.env.AGENT_SENTRY_SESSION_ID || 'cli',
      agent_id: args.agent || process.env.AGENT_SENTRY_AGENT_ID || 'hook',
      event_type: args.type || 'decision',
      severity: args.severity || 'low',
      skill: args.skill || 'system',
      title: (args.title || 'CLI capture event').slice(0, 120),
      detail: args.detail || '',
      affected_files: args.files ? args.files.split(',').map(f => f.trim()) : [],
      tags: args.tags ? args.tags.split(',').map(t => t.trim()) : [],
      metadata: { source: 'cli-capture' },
    });
  } finally {
    await store.close();
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

main().catch((err) => {
  console.error('[AgentSentry] CLI capture error:', err.message);
  process.exit(1);
});
