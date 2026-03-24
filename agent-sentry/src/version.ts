/**
 * version.ts — Single source of truth for the AgentSentry version string.
 *
 * Reads from package.json so the version is never hardcoded in source.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// In compiled output (dist/src/version.js), package.json is two levels up.
// In source (src/version.ts), it is one level up.
// Try compiled path first, then source path.
function loadVersion(): string {
  const candidates = [
    resolve(__dirname, '../../package.json'),   // dist/src/ → package.json
    resolve(__dirname, '../package.json'),       // src/ → package.json
  ];

  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
      if (typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }

  return '0.0.0';
}

export const VERSION: string = loadVersion();
