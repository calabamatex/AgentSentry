import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const agentSentryRoot = path.resolve(__dirname, '../..');

describe('Build contracts', () => {
  it('dist/src/mcp/server.js exists after build', () => {
    const filePath = path.join(agentSentryRoot, 'dist/src/mcp/server.js');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('dist/src/memory/store.js exists after build', () => {
    const filePath = path.join(agentSentryRoot, 'dist/src/memory/store.js');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('dist/src/primitives/risk-scoring.js exists after build', () => {
    const filePath = path.join(agentSentryRoot, 'dist/src/primitives/risk-scoring.js');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('dist/src/enablement/engine.js exists after build', () => {
    const filePath = path.join(agentSentryRoot, 'dist/src/enablement/engine.js');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('package.json main field is defined and dist/ directory exists', () => {
    const pkgPath = path.join(agentSentryRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.main).toBeDefined();
    // dist/ must exist after build; barrel export (src/index.ts) is M2 work
    expect(fs.existsSync(path.join(agentSentryRoot, 'dist'))).toBe(true);
  });

  it('plugin commit-monitor metadata.json exists and has required fields', () => {
    const metadataPath = path.join(
      agentSentryRoot,
      'plugins/core/commit-monitor/metadata.json',
    );
    expect(fs.existsSync(metadataPath)).toBe(true);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    expect(metadata).toHaveProperty('name');
    expect(metadata).toHaveProperty('version');
    expect(metadata).toHaveProperty('category');
    expect(metadata).toHaveProperty('author');
  });

  it('agent-sentry.config.json exists and is valid JSON', () => {
    const configPath = path.join(agentSentryRoot, 'agent-sentry.config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });
});
