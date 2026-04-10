/**
 * Tests for PluginRegistry — local plugin registry (M4 Task 4.4).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PluginRegistry } from '../../src/plugins/registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-sentry-registry-test-'));
}

function createPluginDir(base: string, subdir: string, name: string, overrides?: Record<string, unknown>): string {
  const dir = join(base, subdir, name);
  mkdirSync(dir, { recursive: true });

  const metadata = {
    name,
    description: `Test plugin: ${name}`,
    category: 'monitor',
    author: { name: 'Test Author', github: 'test' },
    version: '1.0.0',
    requires: { 'agentsentry': '>=0.5.0' },
    hooks: ['PostToolUse'],
    tags: ['test'],
    difficulty: 'beginner',
    ...overrides,
  };

  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = createTempDir();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PluginRegistry.scan()', () => {
  it('should discover plugins from core/ and community/ dirs', async () => {
    createPluginDir(tempDir, 'core', 'alpha-monitor');
    createPluginDir(tempDir, 'community', 'beta-tracker', { category: 'auditor', tags: ['audit'] });

    const registry = new PluginRegistry(tempDir);
    const plugins = await registry.scan();

    expect(plugins).toHaveLength(2);
    const names = plugins.map((p) => p.manifest.name);
    expect(names).toContain('alpha-monitor');
    expect(names).toContain('beta-tracker');
  });

  it('should set correct source for each plugin', async () => {
    createPluginDir(tempDir, 'core', 'core-plugin');
    createPluginDir(tempDir, 'community', 'community-plugin');

    const registry = new PluginRegistry(tempDir);
    const plugins = await registry.scan();

    const corePlugin = plugins.find((p) => p.manifest.name === 'core-plugin');
    const communityPlugin = plugins.find((p) => p.manifest.name === 'community-plugin');

    expect(corePlugin?.source).toBe('core');
    expect(communityPlugin?.source).toBe('community');
  });

  it('should ignore dirs without metadata.json', async () => {
    createPluginDir(tempDir, 'core', 'valid-plugin');
    // Create a directory without metadata.json
    mkdirSync(join(tempDir, 'core', 'no-metadata'), { recursive: true });
    writeFileSync(join(tempDir, 'core', 'no-metadata', 'README.md'), 'nothing');

    const registry = new PluginRegistry(tempDir);
    const plugins = await registry.scan();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('valid-plugin');
  });

  it('should skip plugins with invalid JSON in metadata', async () => {
    createPluginDir(tempDir, 'core', 'good-plugin');
    const badDir = join(tempDir, 'core', 'bad-json');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'metadata.json'), '{invalid json');

    const registry = new PluginRegistry(tempDir);
    const plugins = await registry.scan();

    expect(plugins).toHaveLength(1);
  });

  it('should handle non-existent source directories gracefully', async () => {
    const registry = new PluginRegistry(tempDir);
    const plugins = await registry.scan();
    expect(plugins).toHaveLength(0);
  });
});

describe('PluginRegistry.list()', () => {
  it('should return all plugins when no options given', async () => {
    createPluginDir(tempDir, 'core', 'plug-a');
    createPluginDir(tempDir, 'core', 'plug-b');
    createPluginDir(tempDir, 'community', 'plug-c');

    const registry = new PluginRegistry(tempDir);
    await registry.scan();
    const list = await registry.list();

    expect(list).toHaveLength(3);
  });

  it('should filter by category', async () => {
    createPluginDir(tempDir, 'core', 'mon-plugin', { category: 'monitor' });
    createPluginDir(tempDir, 'core', 'aud-plugin', { category: 'auditor' });
    createPluginDir(tempDir, 'core', 'dash-plugin', { category: 'dashboard' });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const monitors = await registry.list({ category: 'monitor' });
    expect(monitors).toHaveLength(1);
    expect(monitors[0].manifest.name).toBe('mon-plugin');

    const auditors = await registry.list({ category: 'auditor' });
    expect(auditors).toHaveLength(1);
  });

  it('should filter by tags', async () => {
    createPluginDir(tempDir, 'core', 'git-mon', { tags: ['git', 'monitoring'] });
    createPluginDir(tempDir, 'core', 'sec-mon', { tags: ['security', 'monitoring'] });
    createPluginDir(tempDir, 'core', 'perf-mon', { tags: ['performance'] });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const gitPlugins = await registry.list({ tags: ['git'] });
    expect(gitPlugins).toHaveLength(1);
    expect(gitPlugins[0].manifest.name).toBe('git-mon');

    const monPlugins = await registry.list({ tags: ['monitoring'] });
    expect(monPlugins).toHaveLength(2);
  });

  it('should filter by difficulty', async () => {
    createPluginDir(tempDir, 'core', 'easy-plug', { difficulty: 'beginner' });
    createPluginDir(tempDir, 'core', 'hard-plug', { difficulty: 'advanced' });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const beginner = await registry.list({ difficulty: 'beginner' });
    expect(beginner).toHaveLength(1);
    expect(beginner[0].manifest.name).toBe('easy-plug');
  });

  it('should text search against name and description', async () => {
    createPluginDir(tempDir, 'core', 'commit-watcher', { description: 'Watches commits' });
    createPluginDir(tempDir, 'core', 'file-scanner', { description: 'Scans files for issues' });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const results = await registry.list({ query: 'commit' });
    expect(results).toHaveLength(1);
    expect(results[0].manifest.name).toBe('commit-watcher');

    const descResults = await registry.list({ query: 'scans' });
    expect(descResults).toHaveLength(1);
    expect(descResults[0].manifest.name).toBe('file-scanner');
  });

  it('should text search against tags', async () => {
    createPluginDir(tempDir, 'core', 'sec-plugin', { tags: ['security', 'audit'] });
    createPluginDir(tempDir, 'core', 'other-plugin', { tags: ['monitoring'] });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const results = await registry.list({ query: 'security' });
    expect(results).toHaveLength(1);
    expect(results[0].manifest.name).toBe('sec-plugin');
  });

  it('should sort by name', async () => {
    createPluginDir(tempDir, 'core', 'charlie');
    createPluginDir(tempDir, 'core', 'alpha');
    createPluginDir(tempDir, 'core', 'bravo');

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const sorted = await registry.list({ sort: 'name' });
    expect(sorted.map((p) => p.manifest.name)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('should sort by downloads', async () => {
    createPluginDir(tempDir, 'core', 'low-dl', { downloads: 10 });
    createPluginDir(tempDir, 'core', 'high-dl', { downloads: 1000 });
    createPluginDir(tempDir, 'core', 'mid-dl', { downloads: 100 });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const sorted = await registry.list({ sort: 'downloads' });
    expect(sorted.map((p) => p.manifest.name)).toEqual(['high-dl', 'mid-dl', 'low-dl']);
  });

  it('should sort by rating', async () => {
    createPluginDir(tempDir, 'core', 'low-rated', { rating: 3.0 });
    createPluginDir(tempDir, 'core', 'high-rated', { rating: 5.0 });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const sorted = await registry.list({ sort: 'rating' });
    expect(sorted[0].manifest.name).toBe('high-rated');
    expect(sorted[1].manifest.name).toBe('low-rated');
  });

  it('should respect limit', async () => {
    createPluginDir(tempDir, 'core', 'plug-a');
    createPluginDir(tempDir, 'core', 'plug-b');
    createPluginDir(tempDir, 'core', 'plug-c');

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const limited = await registry.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe('PluginRegistry.get()', () => {
  it('should return plugin by name', async () => {
    createPluginDir(tempDir, 'core', 'my-plugin');

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const plugin = await registry.get('my-plugin');
    expect(plugin).not.toBeNull();
    expect(plugin!.manifest.name).toBe('my-plugin');
  });

  it('should return null for non-existent plugin', async () => {
    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    const plugin = await registry.get('does-not-exist');
    expect(plugin).toBeNull();
  });
});

describe('PluginRegistry.validate()', () => {
  it('should accept a valid plugin', async () => {
    const dir = createPluginDir(tempDir, 'staging', 'valid-plugin');

    const registry = new PluginRegistry(tempDir);
    const result = await registry.validate(dir);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing required fields', async () => {
    const dir = join(tempDir, 'staging', 'bad-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ name: 'bad-plugin' }));

    const registry = new PluginRegistry(tempDir);
    const result = await registry.validate(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing required field'))).toBe(true);
  });

  it('should reject invalid category', async () => {
    const dir = join(tempDir, 'staging', 'bad-cat');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'metadata.json'),
      JSON.stringify({
        name: 'bad-cat',
        description: 'test',
        category: 'invalid-category',
        author: { name: 'Test' },
        version: '1.0.0',
        requires: { 'agentsentry': '>=0.5.0' },
        hooks: [],
        tags: ['test'],
        difficulty: 'beginner',
      }),
    );

    const registry = new PluginRegistry(tempDir);
    const result = await registry.validate(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid category'))).toBe(true);
  });

  it('should reject invalid hooks', async () => {
    const dir = join(tempDir, 'staging', 'bad-hooks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'metadata.json'),
      JSON.stringify({
        name: 'bad-hooks',
        description: 'test',
        category: 'monitor',
        author: { name: 'Test' },
        version: '1.0.0',
        requires: { 'agentsentry': '>=0.5.0' },
        hooks: ['NonExistentHook'],
        tags: ['test'],
        difficulty: 'beginner',
      }),
    );

    const registry = new PluginRegistry(tempDir);
    const result = await registry.validate(dir);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid hook'))).toBe(true);
  });

  it('should reject non-existent directory', async () => {
    const registry = new PluginRegistry(tempDir);
    const result = await registry.validate(join(tempDir, 'does-not-exist'));

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('does not exist');
  });

  it('should reject directory without metadata.json', async () => {
    const dir = join(tempDir, 'staging', 'empty');
    mkdirSync(dir, { recursive: true });

    const registry = new PluginRegistry(tempDir);
    const result = await registry.validate(dir);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('metadata.json not found');
  });

  it('should reject invalid JSON', async () => {
    const dir = join(tempDir, 'staging', 'bad-json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'metadata.json'), 'not json');

    const registry = new PluginRegistry(tempDir);
    const result = await registry.validate(dir);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not valid JSON');
  });
});

describe('PluginRegistry.install()', () => {
  it('should copy plugin to community dir', async () => {
    const sourceDir = createPluginDir(tempDir, 'staging', 'new-plugin');

    const registry = new PluginRegistry(tempDir);
    const installed = await registry.install(sourceDir);

    expect(installed.manifest.name).toBe('new-plugin');
    expect(installed.source).toBe('community');
    expect(installed.enabled).toBe(true);

    const destPath = join(tempDir, 'community', 'new-plugin', 'metadata.json');
    expect(existsSync(destPath)).toBe(true);
  });

  it('should throw on invalid plugin', async () => {
    const badDir = join(tempDir, 'staging', 'bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'metadata.json'), '{}');

    const registry = new PluginRegistry(tempDir);
    await expect(registry.install(badDir)).rejects.toThrow('Invalid plugin');
  });

  it('should throw on duplicate install', async () => {
    const sourceDir = createPluginDir(tempDir, 'staging', 'dupe-plugin');

    const registry = new PluginRegistry(tempDir);
    await registry.install(sourceDir);
    await expect(registry.install(sourceDir)).rejects.toThrow('already installed');
  });
});

describe('PluginRegistry.uninstall()', () => {
  it('should remove plugin from community dir', async () => {
    const sourceDir = createPluginDir(tempDir, 'staging', 'removable');

    const registry = new PluginRegistry(tempDir);
    await registry.install(sourceDir);

    const result = await registry.uninstall('removable');
    expect(result).toBe(true);

    const destPath = join(tempDir, 'community', 'removable');
    expect(existsSync(destPath)).toBe(false);
  });

  it('should return false for non-existent plugin', async () => {
    const registry = new PluginRegistry(tempDir);
    await registry.scan();
    const result = await registry.uninstall('ghost');
    expect(result).toBe(false);
  });

  it('should throw when trying to uninstall core plugin', async () => {
    createPluginDir(tempDir, 'core', 'core-only');

    const registry = new PluginRegistry(tempDir);
    await registry.scan();
    await expect(registry.uninstall('core-only')).rejects.toThrow('Cannot uninstall core');
  });
});

describe('PluginRegistry.enable() / disable()', () => {
  it('should toggle plugin state', async () => {
    createPluginDir(tempDir, 'core', 'toggle-me');

    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    let plugin = await registry.get('toggle-me');
    expect(plugin!.enabled).toBe(true);

    await registry.disable('toggle-me');
    plugin = await registry.get('toggle-me');
    expect(plugin!.enabled).toBe(false);

    await registry.enable('toggle-me');
    plugin = await registry.get('toggle-me');
    expect(plugin!.enabled).toBe(true);
  });

  it('should return false for non-existent plugin', async () => {
    const registry = new PluginRegistry(tempDir);
    await registry.scan();

    expect(await registry.enable('ghost')).toBe(false);
    expect(await registry.disable('ghost')).toBe(false);
  });
});

describe('PluginRegistry.getState()', () => {
  it('should return correct counts', async () => {
    createPluginDir(tempDir, 'core', 'mon-a', { category: 'monitor' });
    createPluginDir(tempDir, 'core', 'mon-b', { category: 'monitor' });
    createPluginDir(tempDir, 'core', 'aud-a', { category: 'auditor' });

    const registry = new PluginRegistry(tempDir);
    await registry.scan();
    await registry.disable('mon-b');

    const state = await registry.getState();
    expect(state.installed).toBe(3);
    expect(state.enabled).toBe(2);
    expect(state.byCategory.monitor).toBe(2);
    expect(state.byCategory.auditor).toBe(1);
  });
});

describe('State persistence', () => {
  it('should save and reload state across registry instances', async () => {
    createPluginDir(tempDir, 'core', 'persist-plugin');

    // First instance: disable and save
    const registry1 = new PluginRegistry(tempDir);
    await registry1.scan();
    await registry1.disable('persist-plugin');

    // Verify state file exists
    const stateFile = join(tempDir, 'registry.json');
    expect(existsSync(stateFile)).toBe(true);

    // Second instance: should load saved state
    const registry2 = new PluginRegistry(tempDir);
    await registry2.scan();

    const plugin = await registry2.get('persist-plugin');
    expect(plugin!.enabled).toBe(false);
  });

  it('should handle corrupt state file gracefully', async () => {
    createPluginDir(tempDir, 'core', 'safe-plugin');
    writeFileSync(join(tempDir, 'registry.json'), 'not json');

    const registry = new PluginRegistry(tempDir);
    const plugins = await registry.scan();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].enabled).toBe(true); // Defaults to enabled
  });
});
