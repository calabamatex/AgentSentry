#!/usr/bin/env node
/**
 * mcp-smoke.cjs — Drive one real MCP round-trip against the packed artifact (WI-013).
 *
 * Spawns the installed MCP server over stdio, performs the JSON-RPC handshake,
 * lists tools, and calls agent_sentry_check_context. Exits non-zero on any
 * failure so the CI smoke job catches artifacts whose MCP surface is broken.
 *
 * Usage (from a directory where the package is installed):
 *   node mcp-smoke.cjs [path-to-server.js]
 */

const { spawn } = require('child_process');

const serverPath =
  process.argv[2] || 'node_modules/@calabamatex/agentsentry/dist/src/mcp/server.js';

const srv = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const pending = new Map();

srv.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // non-protocol output
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(obj) {
  srv.stdin.write(JSON.stringify(obj) + '\n');
}

function request(id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function fail(err) {
  console.error('MCP smoke FAILED:', err && err.message ? err.message : err);
  srv.kill();
  process.exit(1);
}

(async () => {
  const init = await request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.0' },
  });
  if (!init.result || init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const list = await request(2, 'tools/list', {});
  if (!list.result || !Array.isArray(list.result.tools)) {
    throw new Error(`tools/list failed: ${JSON.stringify(list.error ?? list)}`);
  }
  const names = list.result.tools.map((t) => t.name);
  if (!names.includes('agent_sentry_check_context')) {
    throw new Error(`agent_sentry_check_context missing from tools: ${names.join(', ')}`);
  }

  const call = await request(3, 'tools/call', {
    name: 'agent_sentry_check_context',
    arguments: { message_count: 10 },
  });
  if (call.error || !call.result) {
    throw new Error(`tools/call failed: ${JSON.stringify(call.error ?? call)}`);
  }
  const text = JSON.stringify(call.result);
  if (!text.includes('estimated_tokens')) {
    throw new Error(`unexpected check_context result: ${text.slice(0, 200)}`);
  }

  console.log(`MCP smoke OK: ${names.length} tools; check_context round-trip valid`);
  srv.kill();
  process.exit(0);
})().catch(fail);
