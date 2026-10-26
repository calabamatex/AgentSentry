/**
 * risk-score.test.ts — Phase E: agent_sentry_risk_score MCP tool.
 *
 * Drives the tool against a REAL in-memory store; only getSharedStore and
 * resolveConfigPath are stubbed (DI of the store + control of the enablement
 * level read from disk).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../../../src/memory/store';

const shared = vi.hoisted(() => ({ store: null as unknown, configPath: undefined as string | undefined }));

vi.mock('../../../src/mcp/shared-store', () => ({
  getSharedStore: vi.fn(async () => shared.store),
}));
vi.mock('../../../src/config/resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/resolve')>();
  return { ...actual, resolveConfigPath: vi.fn(() => shared.configPath) };
});

import { handler, name } from '../../../src/mcp/tools/risk-score';

function createStore(): MemoryStore {
  return new MemoryStore({
    config: {
      enabled: true,
      provider: 'sqlite',
      embedding_provider: 'noop',
      database_path: ':memory:',
      max_events: 100000,
      auto_prune_days: 365,
    },
  });
}

let level2Path: string;
let level6Path: string;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-cfg-'));
  level2Path = path.join(dir, 'l2.json');
  level6Path = path.join(dir, 'l6.json');
  fs.writeFileSync(level2Path, JSON.stringify({ enablement: { level: 2 } }));
  fs.writeFileSync(level6Path, JSON.stringify({ enablement: { level: 6 } }));
});

describe('agent_sentry_risk_score', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = createStore();
    await store.initialize();
    shared.store = store;
    shared.configPath = level6Path;
  });

  afterEach(async () => {
    await store.close();
    shared.store = null;
  });

  it('has the expected tool name', () => {
    expect(name).toBe('agent_sentry_risk_score');
  });

  it('is gated: below Level 6 it returns an enable message and does not score', async () => {
    shared.configPath = level2Path;
    const result = await handler({});
    expect(result.content[0].text).toMatch(/Level 6/);
    expect(result.content[0].text).not.toMatch(/session_risk_level/);
  });

  it('reports no session when the store is empty (Level 6)', async () => {
    const result = await handler({});
    expect(result.content[0].text).toMatch(/No session events/);
  });

  it('scores the most recent session with a confidence-labeled result', async () => {
    await store.capture({
      timestamp: new Date().toISOString(),
      session_id: 'sess-1',
      agent_id: 'a',
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'edit',
      detail: 'changed a file',
      affected_files: ['src/a.ts'],
      tags: [],
      metadata: {},
    });

    const result = await handler({
      context_utilization: 0.85,
      uncommitted_files: 14,
      minutes_since_commit: 50,
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.session_id).toBe('sess-1');
    expect(typeof parsed.session_risk_level).toBe('number');
    // No calibration data yet → honest default_priors label.
    expect(parsed.confidence.basis).toBe('default_priors');
    // Live signals should surface the Blind Bulldozing compound risk.
    expect(parsed.compound_risks.map((c: { id: string }) => c.id)).toContain('blind_bulldozing');
    expect(parsed.explanation).toBeTruthy();
  });

  it('rejects an out-of-range context_utilization', async () => {
    const result = await handler({ context_utilization: 2 });
    expect(result.content[0].text).toMatch(/Error scoring risk/);
  });
});
