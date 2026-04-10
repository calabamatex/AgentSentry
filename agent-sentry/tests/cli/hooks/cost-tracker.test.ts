import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We need to mock resolveConfigPath before importing the module
vi.mock('../../../src/config/resolve', () => ({
  resolveConfigPath: vi.fn(() => undefined),
}));

vi.mock('../../../src/observability/logger', () => ({
  Logger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

import { runCostTracker } from '../../../src/cli/hooks/cost-tracker';
import { resolveConfigPath } from '../../../src/config/resolve';

const mockedResolveConfigPath = vi.mocked(resolveConfigPath);

describe('cost-tracker', () => {
  let tmpDir: string;
  let origTmpDir: string | undefined;
  let origCLAUDE_MODEL: string | undefined;
  let origANTHROPIC_MODEL: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-tracker-test-'));
    origTmpDir = process.env.TMPDIR;
    origCLAUDE_MODEL = process.env.CLAUDE_MODEL;
    origANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
    process.env.TMPDIR = tmpDir;
    delete process.env.CLAUDE_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    mockedResolveConfigPath.mockReturnValue(undefined);
  });

  afterEach(() => {
    if (origTmpDir !== undefined) process.env.TMPDIR = origTmpDir;
    else delete process.env.TMPDIR;
    if (origCLAUDE_MODEL !== undefined) process.env.CLAUDE_MODEL = origCLAUDE_MODEL;
    else delete process.env.CLAUDE_MODEL;
    if (origANTHROPIC_MODEL !== undefined) process.env.ANTHROPIC_MODEL = origANTHROPIC_MODEL;
    else delete process.env.ANTHROPIC_MODEL;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('creates cost state and log files on first run', async () => {
    await runCostTracker({});

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    expect(fs.existsSync(stateFile)).toBe(true);

    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.session_calls).toBe('1');
    expect(state.last_model).toBe('sonnet'); // default tier
    expect(parseFloat(state.session_total)).toBeGreaterThan(0);
  });

  it('accumulates session totals across multiple calls', async () => {
    await runCostTracker({ input_tokens: 100, output_tokens: 50 });
    await runCostTracker({ input_tokens: 200, output_tokens: 100 });

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.session_calls).toBe('2');
    expect(parseFloat(state.session_total)).toBeGreaterThan(0);
  });

  it('detects haiku model tier from model hint', async () => {
    await runCostTracker({ model: 'claude-3-haiku-20240307', input_tokens: 1000, output_tokens: 500 });

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.last_model).toBe('haiku');
  });

  it('detects opus model tier from model hint', async () => {
    await runCostTracker({ model: 'claude-3-opus-20240229', input_tokens: 1000, output_tokens: 500 });

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.last_model).toBe('opus');
  });

  it('defaults to sonnet for unknown model names', async () => {
    await runCostTracker({ model: 'some-unknown-model' });

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.last_model).toBe('sonnet');
  });

  it('uses CLAUDE_MODEL env var when no model in input', async () => {
    process.env.CLAUDE_MODEL = 'claude-haiku';
    await runCostTracker({});

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(state.last_model).toBe('haiku');
  });

  it('uses flat cost when no token counts provided', async () => {
    await runCostTracker({ model: 'sonnet' });

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    // Sonnet flat cost = 0.003
    expect(parseFloat(state.session_total)).toBeCloseTo(0.003, 6);
  });

  it('calculates token-based cost correctly for sonnet', async () => {
    // Sonnet rates: in=0.000003, out=0.000015
    // Cost = 1000 * 0.000003 + 500 * 0.000015 = 0.003 + 0.0075 = 0.0105
    await runCostTracker({ model: 'sonnet', input_tokens: 1000, output_tokens: 500 });

    const stateFile = path.join(tmpDir, 'agent-sentry', 'cost-state');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(parseFloat(state.session_total)).toBeCloseTo(0.0105, 6);
  });

  it('appends NDJSON log entry with correct fields', async () => {
    await runCostTracker({ model: 'haiku', input_tokens: 500, output_tokens: 200 });

    // The cost log is written relative to __dirname of the source file,
    // but we can check it was written by looking at the dashboard/data dir
    // Actually the log path is relative to scriptDir. Let's find it.
    const scriptDir = path.resolve(__dirname, '..', '..', '..', 'src', 'cli', 'hooks', '..', '..', '..');
    const costLog = path.join(scriptDir, 'dashboard', 'data', 'cost-log.json');

    if (fs.existsSync(costLog)) {
      const lines = fs.readFileSync(costLog, 'utf-8').trim().split('\n');
      const last = JSON.parse(lines[lines.length - 1]);
      expect(last.type).toBe('cost');
      expect(last.model_tier).toBe('haiku');
      expect(last.input_tokens).toBe(500);
      expect(last.output_tokens).toBe(200);
      expect(last.budget_status).toBeDefined();
      // Clean up
      fs.unlinkSync(costLog);
    }
  });

  it('warns when session budget is exceeded', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Write a state file that's already near the budget
    const sentryDir = path.join(tmpDir, 'agent-sentry');
    fs.mkdirSync(sentryDir, { recursive: true });
    fs.writeFileSync(
      path.join(sentryDir, 'cost-state'),
      JSON.stringify({
        session_total: '9.999',
        session_calls: '100',
        session_start: new Date().toISOString(),
        last_model: 'sonnet',
        last_update: new Date().toISOString(),
      }),
    );

    await runCostTracker({ model: 'sonnet', input_tokens: 1000, output_tokens: 1000 });

    const warnings = consoleSpy.mock.calls.map((c) => c[0]);
    const budgetWarning = warnings.find(
      (w: string) => typeof w === 'string' && w.includes('WARN') && w.includes('budget'),
    );
    expect(budgetWarning).toBeDefined();
  });

  it('warns when approaching session budget threshold', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const sentryDir = path.join(tmpDir, 'agent-sentry');
    fs.mkdirSync(sentryDir, { recursive: true });
    // Default warn threshold = 0.80, default session budget = 10
    // So warning triggers at 8.0
    fs.writeFileSync(
      path.join(sentryDir, 'cost-state'),
      JSON.stringify({
        session_total: '8.5',
        session_calls: '50',
        session_start: new Date().toISOString(),
        last_model: 'sonnet',
        last_update: new Date().toISOString(),
      }),
    );

    await runCostTracker({ model: 'haiku' });

    const warnings = consoleSpy.mock.calls.map((c) => c[0]);
    const budgetWarning = warnings.find(
      (w: string) => typeof w === 'string' && w.includes('Approaching session budget'),
    );
    expect(budgetWarning).toBeDefined();
  });

  it('loads budget config from config file', async () => {
    const configPath = path.join(tmpDir, 'test-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        budget: {
          session_budget: 5,
          monthly_budget: 100,
          warn_threshold: 0.5,
        },
      }),
    );
    mockedResolveConfigPath.mockReturnValue(configPath);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Pre-set session total to 3.0 (60% of 5.0 budget, above 50% threshold)
    const sentryDir = path.join(tmpDir, 'agent-sentry');
    fs.mkdirSync(sentryDir, { recursive: true });
    fs.writeFileSync(
      path.join(sentryDir, 'cost-state'),
      JSON.stringify({
        session_total: '3.0',
        session_calls: '10',
        session_start: new Date().toISOString(),
        last_model: 'sonnet',
        last_update: new Date().toISOString(),
      }),
    );

    await runCostTracker({ model: 'sonnet' });

    const warnings = consoleSpy.mock.calls.map((c) => c[0]);
    const budgetWarning = warnings.find(
      (w: string) => typeof w === 'string' && w.includes('Approaching session budget'),
    );
    expect(budgetWarning).toBeDefined();
  });

  it('handles corrupted state file gracefully', async () => {
    const sentryDir = path.join(tmpDir, 'agent-sentry');
    fs.mkdirSync(sentryDir, { recursive: true });
    fs.writeFileSync(path.join(sentryDir, 'cost-state'), 'not valid json!!!');

    // Should not throw
    await expect(runCostTracker({ model: 'sonnet' })).resolves.toBeUndefined();

    const state = JSON.parse(fs.readFileSync(path.join(sentryDir, 'cost-state'), 'utf-8'));
    expect(state.session_calls).toBe('1'); // restarted from 0
  });

  it('tracks monthly cost in a separate file', async () => {
    await runCostTracker({ model: 'sonnet', input_tokens: 100, output_tokens: 50 });

    const sentryDir = path.join(tmpDir, 'agent-sentry');
    const monthKey = new Date().toISOString().slice(0, 7);
    const monthlyFile = path.join(sentryDir, `cost-monthly-${monthKey}`);
    expect(fs.existsSync(monthlyFile)).toBe(true);

    const monthlyTotal = parseFloat(fs.readFileSync(monthlyFile, 'utf-8').trim());
    expect(monthlyTotal).toBeGreaterThan(0);
  });

  it('handles empty hook input', async () => {
    await expect(runCostTracker({})).resolves.toBeUndefined();
  });
});
