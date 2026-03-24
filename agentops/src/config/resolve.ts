/**
 * resolve.ts — Unified config path resolution.
 *
 * Resolution order:
 * 1. Explicit configPath argument
 * 2. AGENT_SENTRY_CONFIG environment variable
 * 3. ./agent-sentry.config.json (CWD)
 * 4. ./agent-sentry/agent-sentry.config.json (CWD/agent-sentry — repo-clone layout)
 * 5. Package-relative fallback (relative to this file in dist/)
 * 6. Returns undefined → callers fall back to DEFAULT_CONFIG
 */

import * as fs from 'fs';
import * as path from 'path';

export function resolveConfigPath(explicit?: string): string | undefined {
  // 1. Explicit argument
  if (explicit && fs.existsSync(explicit)) {
    return path.resolve(explicit);
  }

  // 2. Environment variable
  const envPath = process.env.AGENT_SENTRY_CONFIG;
  if (envPath && fs.existsSync(envPath)) {
    return path.resolve(envPath);
  }

  // 3. CWD direct
  const cwdDirect = path.resolve('agent-sentry.config.json');
  if (fs.existsSync(cwdDirect)) {
    return cwdDirect;
  }

  // 4. CWD/agent-sentry (repo-clone layout)
  const cwdSubdir = path.resolve('agent-sentry/agent-sentry.config.json');
  if (fs.existsSync(cwdSubdir)) {
    return cwdSubdir;
  }

  // 5. Package-relative (works for npm install)
  const pkgRelative = path.join(__dirname, '..', '..', 'agentops.config.json');
  if (fs.existsSync(pkgRelative)) {
    return path.resolve(pkgRelative);
  }

  // 6. Not found — callers use DEFAULT_CONFIG
  return undefined;
}

/**
 * Resolve a database path. If relative, resolve relative to the config file's
 * directory. If no config file, use ~/.agentops/data/ as home-dir fallback.
 */
export function resolveDatabasePath(dbPath: string, configFilePath?: string): string {
  // SQLite special paths (e.g. ':memory:') used as-is
  if (dbPath === ':memory:' || dbPath.startsWith(':')) {
    return dbPath;
  }

  // Absolute paths used as-is
  if (path.isAbsolute(dbPath)) {
    return dbPath;
  }

  // Relative to config file directory if known
  if (configFilePath) {
    return path.resolve(path.dirname(configFilePath), dbPath);
  }

  // Home directory fallback
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.resolve(home, '.agentops', 'data', 'ops.db');
}
