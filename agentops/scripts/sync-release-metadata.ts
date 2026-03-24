#!/usr/bin/env tsx
/**
 * sync-release-metadata.ts — Single source of truth for release state.
 *
 * Reads actual test results, config defaults, and package version,
 * then writes a canonical release-metadata.json. Optionally patches
 * README.md test count in-place.
 *
 * Usage:
 *   npx tsx scripts/sync-release-metadata.ts           # generate metadata
 *   npx tsx scripts/sync-release-metadata.ts --patch    # also patch README
 *   npx tsx scripts/sync-release-metadata.ts --check    # CI mode: fail if drift detected
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const METADATA_PATH = path.join(ROOT, 'release-metadata.json');
const README_PATH = path.join(ROOT, 'README.md');
const PKG_PATH = path.join(ROOT, 'package.json');
const CONFIG_PATH = path.join(ROOT, 'agent-sentry.config.json');

interface ReleaseMetadata {
  version: string;
  testCount: number;
  testFileCount: number;
  skippedTests: number;
  skippedFiles: number;
  enablementDefault: number;
  enablementName: string;
  lastSync: string;
}

// ---------------------------------------------------------------------------
// Gather data
// ---------------------------------------------------------------------------

function getTestCounts(): { tests: number; files: number; skippedTests: number; skippedFiles: number } {
  try {
    const output = execSync('npx vitest run --reporter=json 2>/dev/null', {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 180_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // vitest --reporter=json outputs JSON to stdout
    const json = JSON.parse(output);
    return {
      tests: json.numPassedTests ?? 0,
      files: json.numPassedTestSuites ?? 0,
      skippedTests: json.numPendingTests ?? 0,
      skippedFiles: json.numPendingTestSuites ?? 0,
    };
  } catch {
    // Fallback: parse human-readable output
    const output = execSync('npx vitest run 2>&1 || true', {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 180_000,
    });

    const fileMatch = output.match(/Test Files\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/);
    const testMatch = output.match(/Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/);

    return {
      files: fileMatch ? parseInt(fileMatch[1], 10) : 0,
      skippedFiles: fileMatch && fileMatch[2] ? parseInt(fileMatch[2], 10) : 0,
      tests: testMatch ? parseInt(testMatch[1], 10) : 0,
      skippedTests: testMatch && testMatch[2] ? parseInt(testMatch[2], 10) : 0,
    };
  }
}

function getVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  return pkg.version;
}

function getEnablementDefault(): { level: number; name: string } {
  const LEVEL_NAMES: Record<number, string> = {
    1: 'Safe Ground',
    2: 'Clear Head',
    3: 'House Rules',
    4: 'Right Size',
    5: 'Full Guard',
  };

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const level = config.enablement?.level ?? 2;
  return { level, name: LEVEL_NAMES[level] ?? `Level ${level}` };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function generateMetadata(): ReleaseMetadata {
  console.log('Running tests to get actual counts...');
  const counts = getTestCounts();
  const version = getVersion();
  const enablement = getEnablementDefault();

  const metadata: ReleaseMetadata = {
    version,
    testCount: counts.tests,
    testFileCount: counts.files,
    skippedTests: counts.skippedTests,
    skippedFiles: counts.skippedFiles,
    enablementDefault: enablement.level,
    enablementName: enablement.name,
    lastSync: new Date().toISOString(),
  };

  fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Wrote ${METADATA_PATH}`);
  console.log(`  version:     ${metadata.version}`);
  console.log(`  tests:       ${metadata.testCount} passed (${metadata.testFileCount} files)`);
  console.log(`  enablement:  Level ${metadata.enablementDefault} (${metadata.enablementName})`);

  return metadata;
}

function patchReadme(metadata: ReleaseMetadata): boolean {
  let readme = fs.readFileSync(README_PATH, 'utf-8');
  const testPattern = /All (\d+) tests via vitest/;
  const match = readme.match(testPattern);

  if (!match) {
    console.log('WARNING: Could not find test count pattern in README.md');
    return false;
  }

  const currentCount = parseInt(match[1], 10);
  if (currentCount === metadata.testCount) {
    console.log(`README test count already correct (${currentCount})`);
    return true;
  }

  readme = readme.replace(testPattern, `All ${metadata.testCount} tests via vitest`);
  fs.writeFileSync(README_PATH, readme);
  console.log(`Patched README: ${currentCount} → ${metadata.testCount}`);
  return true;
}

function checkDrift(metadata: ReleaseMetadata): boolean {
  const readme = fs.readFileSync(README_PATH, 'utf-8');
  const testPattern = /All (\d+) tests via vitest/;
  const match = readme.match(testPattern);
  let drifted = false;

  if (match) {
    const readmeCount = parseInt(match[1], 10);
    if (readmeCount !== metadata.testCount) {
      console.error(`DRIFT: README says ${readmeCount} tests, actual is ${metadata.testCount}`);
      drifted = true;
    }
  }

  return !drifted;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const shouldPatch = args.includes('--patch');
const shouldCheck = args.includes('--check');

const metadata = generateMetadata();

if (shouldPatch) {
  patchReadme(metadata);
}

if (shouldCheck) {
  const ok = checkDrift(metadata);
  if (!ok) {
    console.error('\nRelease metadata drift detected. Run: npx tsx scripts/sync-release-metadata.ts --patch');
    process.exit(1);
  }
  console.log('\nNo drift detected.');
}
