/**
 * registry.ts — Local Plugin Registry for AgentOps (M4 Task 4.4)
 *
 * [experimental] Discovers, validates, installs, and manages plugins from
 * core/ and community/ directories. Local directory scanning only — no
 * remote discovery or download. Uses only fs/path — no external dependencies.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginManifest {
  name: string;
  description: string;
  category: 'monitor' | 'integration' | 'dashboard' | 'auditor';
  author: { name: string; github?: string };
  version: string;
  requires: {
    agentops: string;
    primitives?: string[];
  };
  hooks: string[];
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  downloads?: number;
  rating?: number;
  repository?: string;
  homepage?: string;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
  installedAt: string;
  source: 'core' | 'community';
}

export interface PluginSearchOptions {
  query?: string;
  category?: string;
  tags?: string[];
  difficulty?: string;
  sort?: 'name' | 'downloads' | 'rating' | 'newest';
  limit?: number;
}

interface RegistryState {
  plugins: Record<string, { enabled: boolean; installedAt: string; source: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ['monitor', 'auditor', 'dashboard', 'integration'] as const;

const VALID_HOOKS = [
  'PreToolUse', 'PostToolUse', 'SessionStart', 'Stop',
  'PreSession', 'PostSession', 'PrePlan', 'PostPlan',
  'OnError', 'OnMetric', 'OnAuditLog', 'PluginLoaded', 'PluginUnloaded',
];

const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;

const STATE_FILE = 'registry.json';

// ---------------------------------------------------------------------------
// PluginRegistry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private plugins: Map<string, InstalledPlugin> = new Map();
  private pluginsDir: string;
  private stateLoaded = false;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir
      ? resolve(pluginsDir)
      : resolve('plugins');
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /** Scan the filesystem for plugins in core/ and community/ directories. */
  async scan(): Promise<InstalledPlugin[]> {
    this.plugins.clear();
    await this.loadState();

    const sources: Array<{ dir: string; source: InstalledPlugin['source'] }> = [
      { dir: join(this.pluginsDir, 'core'), source: 'core' },
      { dir: join(this.pluginsDir, 'community'), source: 'community' },
      // Note: "marketplace" directory removed — local registry only
    ];

    for (const { dir, source } of sources) {
      if (!existsSync(dir)) continue;

      let entries: string[];
      try {
        entries = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const pluginPath = join(dir, entry);
        const metadataPath = join(pluginPath, 'metadata.json');
        if (!existsSync(metadataPath)) continue;

        try {
          const raw = readFileSync(metadataPath, 'utf-8');
          const manifest = JSON.parse(raw) as PluginManifest;

          // Ensure hooks defaults to empty array
          if (!manifest.hooks) manifest.hooks = [];

          const savedState = this.getSavedPluginState(manifest.name);

          const installed: InstalledPlugin = {
            manifest,
            path: pluginPath,
            enabled: savedState?.enabled ?? true,
            installedAt: savedState?.installedAt ?? new Date().toISOString(),
            source,
          };

          this.plugins.set(manifest.name, installed);
        } catch {
          // Skip plugins with invalid metadata
        }
      }
    }

    return Array.from(this.plugins.values());
  }

  /** List plugins with optional filtering and sorting. */
  async list(options?: PluginSearchOptions): Promise<InstalledPlugin[]> {
    if (this.plugins.size === 0) {
      await this.scan();
    }

    let results = Array.from(this.plugins.values());

    if (options?.category) {
      results = results.filter((p) => p.manifest.category === options.category);
    }

    if (options?.difficulty) {
      results = results.filter((p) => p.manifest.difficulty === options.difficulty);
    }

    if (options?.tags && options.tags.length > 0) {
      results = results.filter((p) =>
        options.tags!.some((tag) => p.manifest.tags.includes(tag)),
      );
    }

    if (options?.query) {
      const q = options.query.toLowerCase();
      results = results.filter((p) => {
        const name = p.manifest.name.toLowerCase();
        const desc = p.manifest.description.toLowerCase();
        const tags = p.manifest.tags.map((t) => t.toLowerCase());
        return name.includes(q) || desc.includes(q) || tags.some((t) => t.includes(q));
      });
    }

    // Sort
    const sort = options?.sort ?? 'name';
    switch (sort) {
      case 'name':
        results.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
        break;
      case 'downloads':
        results.sort((a, b) => (b.manifest.downloads ?? 0) - (a.manifest.downloads ?? 0));
        break;
      case 'rating':
        results.sort((a, b) => (b.manifest.rating ?? 0) - (a.manifest.rating ?? 0));
        break;
      case 'newest':
        results.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
        break;
    }

    if (options?.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /** Get a single plugin by name. */
  async get(name: string): Promise<InstalledPlugin | null> {
    if (this.plugins.size === 0) {
      await this.scan();
    }
    return this.plugins.get(name) ?? null;
  }

  // -----------------------------------------------------------------------
  // Installation
  // -----------------------------------------------------------------------

  /** Install a plugin from a local path into community/. */
  async install(source: string, options?: { category?: string }): Promise<InstalledPlugin> {
    const sourcePath = resolve(source);

    const validation = await this.validate(sourcePath);
    if (!validation.valid) {
      throw new Error(`Invalid plugin: ${validation.errors.join(', ')}`);
    }

    const metadataPath = join(sourcePath, 'metadata.json');
    const manifest = JSON.parse(readFileSync(metadataPath, 'utf-8')) as PluginManifest;

    if (options?.category) {
      manifest.category = options.category as PluginManifest['category'];
    }

    const communityDir = join(this.pluginsDir, 'community');
    if (!existsSync(communityDir)) {
      mkdirSync(communityDir, { recursive: true });
    }

    const destPath = join(communityDir, manifest.name);
    if (existsSync(destPath)) {
      throw new Error(`Plugin "${manifest.name}" is already installed`);
    }

    cpSync(sourcePath, destPath, { recursive: true });

    if (!manifest.hooks) manifest.hooks = [];

    const installed: InstalledPlugin = {
      manifest,
      path: destPath,
      enabled: true,
      installedAt: new Date().toISOString(),
      source: 'community',
    };

    this.plugins.set(manifest.name, installed);
    await this.saveState();

    return installed;
  }

  /** Uninstall a plugin (only community/marketplace plugins). */
  async uninstall(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    if (plugin.source === 'core') {
      throw new Error('Cannot uninstall core plugins');
    }

    if (existsSync(plugin.path)) {
      rmSync(plugin.path, { recursive: true, force: true });
    }

    this.plugins.delete(name);
    await this.saveState();
    return true;
  }

  /** Enable a plugin. */
  async enable(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    plugin.enabled = true;
    await this.saveState();
    return true;
  }

  /** Disable a plugin. */
  async disable(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    plugin.enabled = false;
    await this.saveState();
    return true;
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  /** Validate a plugin directory for correctness. */
  async validate(pluginPath: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const resolvedPath = resolve(pluginPath);

    if (!existsSync(resolvedPath)) {
      return { valid: false, errors: ['Plugin directory does not exist'] };
    }

    const metadataPath = join(resolvedPath, 'metadata.json');
    if (!existsSync(metadataPath)) {
      return { valid: false, errors: ['metadata.json not found'] };
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(metadataPath, 'utf-8'));
    } catch {
      return { valid: false, errors: ['metadata.json is not valid JSON'] };
    }

    const manifestErrors = this.validateManifest(manifest);
    return manifestErrors;
  }

  /** Validate a manifest object against the plugin schema. */
  validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: ['Manifest must be an object'] };
    }

    const m = manifest as Record<string, unknown>;

    // Required fields
    const required = ['name', 'description', 'category', 'author', 'version', 'requires', 'tags'];
    for (const field of required) {
      if (!(field in m)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Name pattern
    if (typeof m.name === 'string' && !/^[a-z0-9-]+$/.test(m.name)) {
      errors.push('Name must be lowercase alphanumeric with hyphens');
    }

    // Version pattern
    if (typeof m.version === 'string' && !/^\d+\.\d+\.\d+$/.test(m.version)) {
      errors.push('Version must follow semver pattern (e.g. 1.0.0)');
    }

    // Category
    if (typeof m.category === 'string' && !(VALID_CATEGORIES as readonly string[]).includes(m.category)) {
      errors.push(`Invalid category: ${m.category}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    // Author
    if (m.author && typeof m.author === 'object') {
      const author = m.author as Record<string, unknown>;
      if (!author.name || typeof author.name !== 'string') {
        errors.push('Author must have a name');
      }
    }

    // Requires
    if (m.requires && typeof m.requires === 'object') {
      const requires = m.requires as Record<string, unknown>;
      if (!('agentops' in requires)) {
        errors.push('Requires must include agentops version');
      }
    }

    // Hooks
    if (Array.isArray(m.hooks)) {
      for (const hook of m.hooks) {
        if (typeof hook === 'string' && !VALID_HOOKS.includes(hook)) {
          errors.push(`Invalid hook: ${hook}. Must be one of: ${VALID_HOOKS.join(', ')}`);
        }
      }
    }

    // Tags
    if (Array.isArray(m.tags) && m.tags.length === 0) {
      errors.push('Tags must have at least one item');
    }

    // Difficulty
    if (
      'difficulty' in m &&
      typeof m.difficulty === 'string' &&
      !(VALID_DIFFICULTIES as readonly string[]).includes(m.difficulty)
    ) {
      errors.push(`Invalid difficulty: ${m.difficulty}. Must be one of: ${VALID_DIFFICULTIES.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  /** Return summary statistics for installed plugins. */
  async getState(): Promise<{ installed: number; enabled: number; byCategory: Record<string, number> }> {
    if (this.plugins.size === 0) {
      await this.scan();
    }

    const byCategory: Record<string, number> = {};
    let enabled = 0;

    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) enabled++;
      const cat = plugin.manifest.category;
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }

    return {
      installed: this.plugins.size,
      enabled,
      byCategory,
    };
  }

  /** Persist plugin enabled/disabled state to registry.json. */
  async saveState(): Promise<void> {
    const state: RegistryState = { plugins: {} };

    for (const [name, plugin] of this.plugins) {
      state.plugins[name] = {
        enabled: plugin.enabled,
        installedAt: plugin.installedAt,
        source: plugin.source,
      };
    }

    const statePath = join(this.pluginsDir, STATE_FILE);
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /** Load persisted state from registry.json. */
  private async loadState(): Promise<void> {
    if (this.stateLoaded) return;

    const statePath = join(this.pluginsDir, STATE_FILE);
    if (!existsSync(statePath)) {
      this.stateLoaded = true;
      return;
    }

    try {
      const raw = readFileSync(statePath, 'utf-8');
      const state = JSON.parse(raw) as RegistryState;
      // State is applied during scan() via getSavedPluginState
      this._loadedState = state;
    } catch {
      // Ignore corrupt state file
    }

    this.stateLoaded = true;
  }

  private _loadedState: RegistryState | null = null;

  private getSavedPluginState(name: string): { enabled: boolean; installedAt: string } | null {
    if (!this._loadedState) return null;
    const saved = this._loadedState.plugins[name];
    if (!saved) return null;
    return { enabled: saved.enabled, installedAt: saved.installedAt };
  }
}
