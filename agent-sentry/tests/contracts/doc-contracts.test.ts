/**
 * doc-contracts.test.ts — Validates documentation, config, and version consistency.
 *
 * These tests catch drift between README claims, config values, and source code.
 * Every assertion here corresponds to a real product-contract bug found previously.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { generateConfigForLevel, validateLevelMatchesSkills, DEFAULT_ENABLEMENT_LEVEL } from '../../src/enablement/engine';

const agentSentryRoot = resolve(__dirname, '../..');
const readFile = (rel: string) => readFileSync(resolve(agentSentryRoot, rel), 'utf8');

describe('Version consistency', () => {
  it('all version references match package.json', () => {
    const pkg = JSON.parse(readFile('package.json'));
    const expectedVersion = pkg.version;

    // version.ts should export the same version at runtime
    // (we test via the source module rather than compiled output)
    const versionSource = readFile('src/version.ts');
    // Verify no hardcoded version string remains in version.ts
    expect(versionSource).not.toContain("'0.5.0'");
    expect(versionSource).not.toContain('"0.5.0"');

    // Verify no hardcoded version strings remain in source files that previously had them
    const filesToCheck = [
      'src/cli/index.ts',
      'src/mcp/server.ts',
      'src/dashboard/server.ts',
      'src/cli/commands/health.ts',
    ];

    for (const file of filesToCheck) {
      const content = readFile(file);
      // Should import VERSION, not hardcode it
      expect(content).toContain('VERSION');
      expect(content).not.toMatch(/version:\s*['"]0\.5\.0['"]/);
      expect(content).not.toMatch(/const VERSION\s*=\s*['"]0\.5\.0['"]/);
    }
  });

  it('README H1 version matches package.json', () => {
    const pkg = JSON.parse(readFile('package.json'));
    const readme = readFile('README.md');
    const h1 = readme.match(/^#\s+AgentSentry\s+v([^\s]+)/m);
    expect(h1).not.toBeNull();
    expect(h1![1]).toBe(pkg.version);
  });

  it('bash CLI resolves version from package.json, never a hardcoded literal (WI-001)', () => {
    // bin/agent-sentry.sh shipped VERSION="4.0.0" against a 0.6.0-beta package.
    const shell = readFile('bin/agent-sentry.sh');
    expect(shell).not.toMatch(/^\s*VERSION="[0-9]/m);
    expect(shell).toContain("require('$AGENT_SENTRY_ROOT/package.json').version");
  });
});

describe('README accuracy — tool/command counts', () => {
  it('README MCP tool count matches the source tools array', () => {
    const server = readFile('src/mcp/server.ts');
    // Extract the `export const tools: ToolDefinition[] = [ ... ];` array body.
    const arrayBody = server.match(/export const tools:[^=]*=\s*\[([\s\S]*?)\]/);
    expect(arrayBody).not.toBeNull();
    const toolCount = arrayBody![1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;

    const readme = readFile('README.md');
    const claim = readme.match(/(\d+)\s+tools/);
    expect(claim).not.toBeNull();
    expect(Number(claim![1])).toBe(toolCount);
  });

  // The repo-root README.md is what GitHub renders on the landing page. It is a
  // separate file from agent-sentry/README.md and previously drifted unnoticed.
  it('repo-root README (GitHub landing page) stays in sync, if present', () => {
    const rootReadmePath = resolve(agentSentryRoot, '..', 'README.md');
    if (!existsSync(rootReadmePath)) return; // not present in standalone-package layouts
    const root = readFileSync(rootReadmePath, 'utf8');

    // Version H1 matches package.json.
    const pkg = JSON.parse(readFile('package.json'));
    const h1 = root.match(/^#\s+AgentSentry\s+v([^\s]+)/m);
    expect(h1, 'root README should have an "# AgentSentry vX" heading').not.toBeNull();
    expect(h1![1]).toBe(pkg.version);

    // Tool count matches the source tools array.
    const server = readFile('src/mcp/server.ts');
    const arrayBody = server.match(/export const tools:[^=]*=\s*\[([\s\S]*?)\]/);
    const toolCount = arrayBody![1].split(',').map((s) => s.trim()).filter((s) => s.length > 0).length;
    const claim = root.match(/(\d+)\s+tools/);
    expect(claim, 'root README should state a tool count').not.toBeNull();
    expect(Number(claim![1])).toBe(toolCount);
  });
});

describe('Enablement config consistency', () => {
  it('config skills match declared level', () => {
    const config = JSON.parse(readFile('agent-sentry.config.json'));
    const level = config.enablement?.level;

    expect(level).toBeGreaterThanOrEqual(1);
    expect(level).toBeLessThanOrEqual(5);

    if (config.enablement?.skills) {
      const drift = validateLevelMatchesSkills(level, config.enablement.skills);
      expect(drift.valid).toBe(true);
      expect(drift.drifted).toEqual([]);
    }
  });

  it('canonical config generation matches documented level table', () => {
    // Level 2 should have save_points + context_health only
    const l2 = generateConfigForLevel(2);
    expect(l2.skills.save_points.enabled).toBe(true);
    expect(l2.skills.context_health.enabled).toBe(true);
    expect(l2.skills.standing_orders.enabled).toBe(false);
    expect(l2.skills.directive_compliance.enabled).toBe(false);
    expect(l2.skills.small_bets.enabled).toBe(false);
    expect(l2.skills.proactive_safety.enabled).toBe(false);
  });

  it('default level agrees everywhere: constant, shipped config, architecture doc, fallbacks (WI-018)', () => {
    // Single source of truth: DEFAULT_ENABLEMENT_LEVEL in enablement/engine.ts.
    // Shipped config must match it.
    const config = JSON.parse(readFile('agent-sentry.config.json'));
    expect(config.enablement?.level).toBe(DEFAULT_ENABLEMENT_LEVEL);

    // enablement-model.md must document the same default.
    const doc = readFile('docs/architecture/enablement-model.md');
    const docDefault = doc.match(/The default level is \*\*(\d)/);
    expect(docDefault).not.toBeNull();
    expect(parseInt(docDefault![1], 10)).toBe(DEFAULT_ENABLEMENT_LEVEL);

    // Fallback code paths must use the constant, not a bare literal
    // (health.ts shipped `= 3` while everything else said 2).
    const healthSrc = readFile('src/mcp/tools/health.ts');
    expect(healthSrc).toContain('DEFAULT_ENABLEMENT_LEVEL');
    expect(healthSrc).not.toMatch(/enablementLevel = \d/);
    const riskSrc = readFile('src/mcp/tools/risk-score.ts');
    expect(riskSrc).toContain('DEFAULT_ENABLEMENT_LEVEL');
    expect(riskSrc).not.toMatch(/let level = \d/);
  });
});

describe('README accuracy', () => {
  it('documented default level matches config file', () => {
    const config = JSON.parse(readFile('agent-sentry.config.json'));
    const readme = readFile('README.md');
    const configLevel = config.enablement?.level;

    // README should mark the correct level as (default)
    const defaultMatch = readme.match(/\*\*([^*]+)\*\*\s*\(default\)/);
    expect(defaultMatch).not.toBeNull();

    // The level name in the default marker should correspond to the config level
    const levelNames: Record<number, string> = {
      1: 'Safe Ground',
      2: 'Clear Head',
      3: 'House Rules',
      4: 'Right Size',
      5: 'Full Guard',
    };
    const expectedName = levelNames[configLevel];
    expect(defaultMatch![1]).toContain(expectedName);
  });
});

describe('Supply-chain integrity', () => {
  it('ONNX model + tokenizer download checksums are pinned (non-empty 64-char hex)', () => {
    const src = readFile('src/memory/embeddings.ts');
    for (const name of ['ONNX_MODEL_SHA256', 'ONNX_TOKENIZER_SHA256']) {
      const m = src.match(new RegExp(`${name}\\s*=\\s*'([0-9a-f]*)'`));
      expect(m, `${name} should be assigned a string literal`).not.toBeNull();
      expect(m![1], `${name} must be a pinned sha256 so download verification runs`).toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
  });
});

describe('No orphaned config keys', () => {
  it('all top-level config keys have consumers in src/', () => {
    const config = JSON.parse(readFile('agent-sentry.config.json'));
    const topLevelKeys = Object.keys(config);

    // These are the known valid top-level keys consumed by src/
    const validKeys = new Set([
      'enabled',
      'save_points',
      'context_health',
      'rules_file',
      'task_sizing',
      'security',
      'budget',
      'notifications',
      'memory',
      'enablement',
    ]);

    for (const key of topLevelKeys) {
      expect(validKeys.has(key)).toBe(true);
    }
  });
});
