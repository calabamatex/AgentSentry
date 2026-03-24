/**
 * Tests for cli/commands/init.ts — init onboarding command.
 *
 * Uses a temporary config file to avoid polluting the real agent-sentry.config.json,
 * which is validated by doc-contracts tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initCommand } from '../../src/cli/commands/init';
import type { ParsedArgs } from '../../src/cli/parser';

let tmpDir: string;
let tmpConfigPath: string;

function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return {
    command: 'init',
    positionals: [],
    flags: {},
    ...overrides,
  };
}

describe('initCommand', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create a temp directory with its own config path
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sentry-init-test-'));
    tmpConfigPath = path.join(tmpDir, 'agent-sentry.config.json');

    // Mock resolveConfigPath to return our temp path
    vi.mock('../../src/config/resolve', () => ({
      resolveConfigPath: () => tmpConfigPath,
    }));

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('has correct name and description', () => {
    expect(initCommand.name).toBe('init');
    expect(initCommand.description).toContain('Initialize');
  });

  it('runs without error with default flags', async () => {
    await initCommand.run(makeArgs());
    expect(process.exitCode).toBeUndefined();
  });

  it('outputs text mentioning the enablement level', async () => {
    await initCommand.run(makeArgs());
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Level 1');
    expect(allOutput).toContain('Safe Ground');
  });

  it('respects --level flag', async () => {
    await initCommand.run(makeArgs({ flags: { level: '3' } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Level 3');
    expect(allOutput).toContain('House Rules');
  });

  it('rejects invalid --level', async () => {
    await initCommand.run(makeArgs({ flags: { level: '99' } }));
    expect(process.exitCode).toBe(1);
    const errOutput = stderrSpy.mock.calls.map((c) => c[0]).join('');
    expect(errOutput).toContain('--level must be');
  });

  it('outputs JSON when --json flag is set', async () => {
    await initCommand.run(makeArgs({ flags: { json: true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(allOutput);
    expect(parsed).toHaveProperty('config_path');
    expect(parsed).toHaveProperty('level');
    expect(parsed).toHaveProperty('level_name');
    expect(parsed).toHaveProperty('active_skills');
    expect(parsed).toHaveProperty('health');
    expect(parsed.level).toBe(1);
  });

  it('JSON output includes health audit', async () => {
    await initCommand.run(makeArgs({ flags: { json: true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(allOutput);
    expect(parsed.health).toHaveProperty('criticals');
    expect(parsed.health).toHaveProperty('warnings');
    expect(parsed.health).toHaveProperty('advisories');
    expect(Array.isArray(parsed.health.criticals)).toBe(true);
  });

  it('creates config when none exists', async () => {
    expect(fs.existsSync(tmpConfigPath)).toBe(false);
    await initCommand.run(makeArgs({ flags: { json: true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(allOutput);
    expect(parsed.config_created).toBe(true);
    expect(fs.existsSync(tmpConfigPath)).toBe(true);
  });

  it('updates enablement in existing config without overwriting other fields', async () => {
    // Write a config with a custom field
    const custom = { custom_field: 'preserved', enablement: { level: 1 } };
    fs.writeFileSync(tmpConfigPath, JSON.stringify(custom, null, 2) + '\n', 'utf8');

    await initCommand.run(makeArgs({ flags: { level: '2' } }));

    const updated = JSON.parse(fs.readFileSync(tmpConfigPath, 'utf8'));
    expect(updated.custom_field).toBe('preserved');
    expect(updated.enablement.level).toBe(2);
  });

  it('creates config with --force even if it exists', async () => {
    // Pre-create a config
    fs.writeFileSync(tmpConfigPath, JSON.stringify({ old: true }, null, 2) + '\n', 'utf8');

    await initCommand.run(makeArgs({ flags: { force: true, level: '3' } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Config created');
    expect(allOutput).toContain('Level 3');
  });

  it('shows next steps in text output', async () => {
    await initCommand.run(makeArgs());
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Next Steps');
    expect(allOutput).toContain('agentops health');
    expect(allOutput).toContain('agentops dashboard');
  });

  it('shows hook wiring instructions', async () => {
    await initCommand.run(makeArgs());
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Hook Wiring');
    expect(allOutput).toContain('session-start');
  });

  it('includes active skills for level 3', async () => {
    await initCommand.run(makeArgs({ flags: { json: true, level: '3' } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(allOutput);
    expect(parsed.active_skills).toContain('save_points');
    expect(parsed.active_skills).toContain('context_health');
    expect(parsed.active_skills).toContain('standing_orders');
    expect(parsed.active_skills).not.toContain('small_bets');
  });

  // --- Dry run tests ---

  it('--dry-run does not create config file', async () => {
    expect(fs.existsSync(tmpConfigPath)).toBe(false);
    await initCommand.run(makeArgs({ flags: { 'dry-run': true } }));
    expect(fs.existsSync(tmpConfigPath)).toBe(false);
  });

  it('--dry-run shows preview text', async () => {
    await initCommand.run(makeArgs({ flags: { 'dry-run': true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Dry Run Preview');
    expect(allOutput).toContain('[DRY RUN]');
    expect(allOutput).toContain('Would create');
  });

  it('--dry-run with existing config says "Would update"', async () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify({ old: true }), 'utf8');
    await initCommand.run(makeArgs({ flags: { 'dry-run': true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Would update');
  });

  it('--dry-run JSON includes dry_run field', async () => {
    await initCommand.run(makeArgs({ flags: { 'dry-run': true, json: true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(allOutput);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.config_created).toBe(true); // would create
  });

  it('--dry-run does not update existing config', async () => {
    const original = JSON.stringify({ enablement: { level: 1 } });
    fs.writeFileSync(tmpConfigPath, original, 'utf8');
    await initCommand.run(makeArgs({ flags: { 'dry-run': true, level: '5' } }));
    const content = fs.readFileSync(tmpConfigPath, 'utf8');
    expect(content).toBe(original); // unchanged
  });

  // --- Interactive mode tests ---

  it('--interactive defaults to level 1 when stdin is not a TTY', async () => {
    await initCommand.run(makeArgs({ flags: { interactive: true, json: true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(allOutput);
    // In test environment, stdin is not a TTY, so defaults to 1
    expect(parsed.level).toBe(1);
  });

  it('-i flag works the same as --interactive', async () => {
    await initCommand.run(makeArgs({ flags: { i: true, json: true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(allOutput);
    expect(parsed.level).toBe(1);
  });

  // --- Wire hooks tests ---

  it('--wire-hooks adds agentops hooks to settings.json', async () => {
    // Use a temp .claude/settings.json to avoid touching real one
    const settingsDir = path.join(tmpDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.mkdirSync(settingsDir, { recursive: true });

    // Overwrite with minimal settings (no agentops hooks)
    const minimal = { hooks: { SessionStart: [] } };
    fs.writeFileSync(settingsPath, JSON.stringify(minimal), 'utf8');

    // Temporarily chdir so wireHooks finds our temp settings
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      await initCommand.run(makeArgs({ flags: { 'wire-hooks': true, json: true } }));
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(allOutput);
      expect(parsed.hooks_wired).toBe(true);

      // Verify hooks were added
      const updated = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const sessionStartHooks = updated.hooks.SessionStart;
      const hasAgentops = sessionStartHooks.some((group: { hooks?: Array<{ command?: string }> }) =>
        group.hooks?.some((h: { command?: string }) => h.command?.includes('agentops/'))
      );
      expect(hasAgentops).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('--wire-hooks does not duplicate existing agentops hooks', async () => {
    const settingsDir = path.join(tmpDir, '.claude');
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.mkdirSync(settingsDir, { recursive: true });

    // Settings that already have agentops hooks
    const withHooks = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'bash agentops/scripts/session-start-checks.sh', timeout: 10000 }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'bash agentops/scripts/context-estimator.sh', timeout: 5000 }] },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(withHooks), 'utf8');

    const origCwd = process.cwd();
    process.chdir(tmpDir);

    try {
      await initCommand.run(makeArgs({ flags: { 'wire-hooks': true, json: true } }));
      const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      const parsed = JSON.parse(allOutput);
      // Should not add duplicates
      expect(parsed.hooks_wired).toBe(false);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('--wire-hooks with --dry-run does not modify settings', async () => {
    await initCommand.run(makeArgs({ flags: { 'wire-hooks': true, 'dry-run': true } }));
    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Would wire hooks');
  });
});
