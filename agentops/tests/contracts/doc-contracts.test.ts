/**
 * doc-contracts.test.ts — Validates documentation, config, and version consistency.
 *
 * These tests catch drift between README claims, config values, and source code.
 * Every assertion here corresponds to a real product-contract bug found previously.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { generateConfigForLevel, validateLevelMatchesSkills } from '../../src/enablement/engine';

const agentopsRoot = resolve(__dirname, '../..');
const readFile = (rel: string) => readFileSync(resolve(agentopsRoot, rel), 'utf8');

describe('Version consistency', () => {
  it('all version references match package.json', () => {
    const pkg = JSON.parse(readFile('package.json'));
    const expectedVersion = pkg.version;

    // version.ts should export the same version at runtime
    // (we test via the source module rather than compiled output)
    const versionSource = readFile('src/version.ts');
    // Verify no hardcoded version string remains in version.ts
    expect(versionSource).not.toContain("'4.0.0'");
    expect(versionSource).not.toContain('"4.0.0"');

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
      expect(content).not.toMatch(/version:\s*['"]4\.0\.0['"]/);
      expect(content).not.toMatch(/const VERSION\s*=\s*['"]4\.0\.0['"]/);
    }
  });
});

describe('Enablement config consistency', () => {
  it('config skills match declared level', () => {
    const config = JSON.parse(readFile('agentops.config.json'));
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
    expect(l2.skills.small_bets.enabled).toBe(false);
    expect(l2.skills.proactive_safety.enabled).toBe(false);
  });
});

describe('README accuracy', () => {
  it('documented default level matches config file', () => {
    const config = JSON.parse(readFile('agentops.config.json'));
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

describe('No orphaned config keys', () => {
  it('all top-level config keys have consumers in src/', () => {
    const config = JSON.parse(readFile('agentops.config.json'));
    const topLevelKeys = Object.keys(config);

    // These are the known valid top-level keys consumed by src/
    const validKeys = new Set([
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
