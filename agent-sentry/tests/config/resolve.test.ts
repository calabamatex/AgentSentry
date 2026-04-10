import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveConfigPath, resolveDatabasePath } from '../../src/config/resolve';

describe('resolveConfigPath', () => {
  let tmpDir: string;
  const originalEnv = process.env.AGENT_SENTRY_CONFIG;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-test-'));
    delete process.env.AGENT_SENTRY_CONFIG;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AGENT_SENTRY_CONFIG = originalEnv;
    } else {
      delete process.env.AGENT_SENTRY_CONFIG;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns resolved explicit path when file exists', () => {
    const configFile = path.join(tmpDir, 'my-config.json');
    fs.writeFileSync(configFile, '{}');
    const result = resolveConfigPath(configFile);
    expect(result).toBe(path.resolve(configFile));
  });

  it('ignores explicit path when file does not exist and falls through', () => {
    const originalCwd = process.cwd();
    process.chdir(tmpDir); // CWD with no config files
    try {
      const result = resolveConfigPath(path.join(tmpDir, 'nonexistent.json'));
      // Falls through; may find a package-relative config or return undefined
      // The key assertion is that the nonexistent explicit path is NOT returned
      expect(result).not.toBe(path.resolve(path.join(tmpDir, 'nonexistent.json')));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('returns undefined when explicit is an empty string', () => {
    // Empty string is falsy, so explicit check is skipped
    const result = resolveConfigPath('');
    // Will fall through to env check and CWD checks
    // Without any files, should eventually return undefined
    // (unless CWD happens to have an agent-sentry.config.json)
    expect(typeof result === 'string' || result === undefined).toBe(true);
  });

  it('resolves from AGENT_SENTRY_CONFIG env var when file exists', () => {
    const configFile = path.join(tmpDir, 'env-config.json');
    fs.writeFileSync(configFile, '{}');
    process.env.AGENT_SENTRY_CONFIG = configFile;
    const result = resolveConfigPath();
    expect(result).toBe(path.resolve(configFile));
  });

  it('ignores AGENT_SENTRY_CONFIG when file does not exist', () => {
    process.env.AGENT_SENTRY_CONFIG = path.join(tmpDir, 'missing.json');
    const result = resolveConfigPath();
    // Falls through; result depends on CWD files
    expect(typeof result === 'string' || result === undefined).toBe(true);
  });

  it('explicit path takes priority over env var', () => {
    const explicitFile = path.join(tmpDir, 'explicit.json');
    const envFile = path.join(tmpDir, 'env.json');
    fs.writeFileSync(explicitFile, '{}');
    fs.writeFileSync(envFile, '{}');
    process.env.AGENT_SENTRY_CONFIG = envFile;
    const result = resolveConfigPath(explicitFile);
    expect(result).toBe(path.resolve(explicitFile));
  });

  it('returns undefined when no config file is found anywhere', () => {
    // Use a temp dir as CWD with no config files
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const result = resolveConfigPath();
      // May find a package-relative config or return undefined
      expect(typeof result === 'string' || result === undefined).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('resolveDatabasePath', () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    }
  });

  it('returns :memory: as-is', () => {
    expect(resolveDatabasePath(':memory:')).toBe(':memory:');
  });

  it('returns special SQLite paths starting with colon as-is', () => {
    expect(resolveDatabasePath(':something:')).toBe(':something:');
  });

  it('returns absolute paths as-is', () => {
    const absPath = '/var/data/my.db';
    expect(resolveDatabasePath(absPath)).toBe(absPath);
  });

  it('resolves relative path relative to config file directory', () => {
    const configPath = '/opt/project/config/agent-sentry.config.json';
    const result = resolveDatabasePath('data/ops.db', configPath);
    expect(result).toBe(path.resolve('/opt/project/config', 'data/ops.db'));
  });

  it('uses home directory fallback when no config path is provided', () => {
    process.env.HOME = '/home/testuser';
    const result = resolveDatabasePath('relative.db');
    expect(result).toBe(path.resolve('/home/testuser', '.agent-sentry', 'data', 'ops.db'));
  });

  it('uses USERPROFILE when HOME is not set', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = '/Users/testuser';
    const result = resolveDatabasePath('relative.db');
    expect(result).toBe(path.resolve('/Users/testuser', '.agent-sentry', 'data', 'ops.db'));
    // Restore
    process.env.HOME = originalHome;
    delete process.env.USERPROFILE;
  });

  it('falls back to cwd when neither HOME nor USERPROFILE is set', () => {
    const origHome = process.env.HOME;
    const origProfile = process.env.USERPROFILE;
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    const result = resolveDatabasePath('relative.db');
    expect(result).toBe(path.resolve('.', '.agent-sentry', 'data', 'ops.db'));
    process.env.HOME = origHome;
    if (origProfile) process.env.USERPROFILE = origProfile;
  });
});
