/**
 * benchmark-regression.test.ts — Performance regression tests for MemoryStore.
 *
 * Runs a subset of the benchmark suite and asserts that key operations
 * meet minimum performance thresholds. Designed to run in CI.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { BenchmarkSuite, BenchmarkReport } from '../../src/memory/benchmark';

// Regression thresholds — based on observed baseline (SQLite, ~22 insert ops/sec).
// Set at ~50% of baseline to allow for CI variability while catching real regressions.
const THRESHOLDS = {
  insert: {
    minOpsPerSecond: 5,      // single inserts: at least 5 ops/sec (baseline ~22)
    maxAvgMs: 200,           // avg insert under 200ms (baseline ~46ms)
  },
  search: {
    minOpsPerSecond: 10,     // keyword search: at least 10 ops/sec (baseline ~59)
    maxAvgMs: 100,           // avg search under 100ms (baseline ~17ms)
  },
  batch: {
    minOpsPerSecond: 15,     // batch inserts: at least 15 ops/sec (baseline ~77)
    maxAvgMs: 70,            // avg per-event under 70ms (baseline ~13ms)
  },
  concurrent: {
    minOpsPerSecond: 15,     // concurrent r/w: at least 15 ops/sec (baseline ~90)
    maxP95Ms: 500,           // P95 under 500ms (baseline ~132ms)
  },
};

describe('MemoryStore performance regression', () => {
  let store: MemoryStore;
  let suite: BenchmarkSuite;
  let report: BenchmarkReport;
  const dbPath = path.join(__dirname, '.benchmark-regression-temp.db');

  beforeAll(async () => {
    // Clean up any previous temp DB
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    const provider = new SqliteProvider(dbPath);
    store = new MemoryStore({ provider });
    await store.initialize();

    // Use fewer iterations for CI speed (100 instead of 500)
    suite = new BenchmarkSuite({ store, iterations: 100 });
    report = await suite.runAll();

    // Log report for CI visibility
    console.log(suite.formatReport(report));
  }, 60_000); // 60s timeout for full benchmark suite

  afterAll(async () => {
    await store.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('single insert meets throughput threshold', () => {
    const result = report.results.find((r) => r.name === 'Insert (single)');
    expect(result).toBeDefined();
    expect(result!.opsPerSecond).toBeGreaterThan(THRESHOLDS.insert.minOpsPerSecond);
    expect(result!.avgTimeMs).toBeLessThan(THRESHOLDS.insert.maxAvgMs);
  });

  it('keyword search meets latency threshold', () => {
    const result = report.results.find((r) => r.name === 'Search (keyword)');
    expect(result).toBeDefined();
    expect(result!.opsPerSecond).toBeGreaterThan(THRESHOLDS.search.minOpsPerSecond);
    expect(result!.avgTimeMs).toBeLessThan(THRESHOLDS.search.maxAvgMs);
  });

  it('batch insert meets throughput threshold', () => {
    const result = report.results.find((r) => r.name === 'Insert (batch)');
    expect(result).toBeDefined();
    expect(result!.opsPerSecond).toBeGreaterThan(THRESHOLDS.batch.minOpsPerSecond);
    expect(result!.avgTimeMs).toBeLessThan(THRESHOLDS.batch.maxAvgMs);
  });

  it('concurrent read/write meets performance threshold', () => {
    const result = report.results.find((r) => r.name === 'Concurrent R/W');
    expect(result).toBeDefined();
    expect(result!.opsPerSecond).toBeGreaterThan(THRESHOLDS.concurrent.minOpsPerSecond);
    expect(result!.p95Ms).toBeDefined();
    expect(result!.p95Ms!).toBeLessThan(THRESHOLDS.concurrent.maxP95Ms);
  });

  it('saves benchmark report as artifact', () => {
    const artifactDir = path.join(__dirname, '..', '..', 'benchmarks');
    if (!fs.existsSync(artifactDir)) {
      fs.mkdirSync(artifactDir, { recursive: true });
    }
    const artifactPath = path.join(artifactDir, 'ci-latest.json');
    fs.writeFileSync(artifactPath, suite.toJSON(report), 'utf-8');

    expect(fs.existsSync(artifactPath)).toBe(true);
  });
});
