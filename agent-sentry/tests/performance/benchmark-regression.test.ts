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

// Regression thresholds. Two kinds of guard, deliberately separated:
//
//   * minOpsPerSecond — the real throughput smoke floor, set at ~5-10% of the
//     isolated baseline (insert ~22, search ~59, batch ~77, concurrent ~90
//     ops/s). A genuine algorithmic regression collapses throughput and trips
//     these.
//   * maxAvgMs / maxP95Ms — absolute wall-clock CEILINGS, set to
//     *catastrophe-only* levels (seconds per op). These are NOT precise
//     regression detectors: wall-clock latency — especially P95 tail latency —
//     balloons under CPU/disk contention on loaded dev boxes and shared CI
//     runners, independent of the code under test. A previous 5000ms P95 ceiling
//     flaked at ~5.8s on a loaded box (44x baseline) while throughput was fine.
//     They now fail only on an unambiguous blowup that sustains seconds per
//     operation — a true O(n^2)/lock-contention regression — not on a slow host.
//     (Same philosophy as the 30s hard ceiling in enforcement-evasion.test.ts.)
const THRESHOLDS = {
  insert: {
    minOpsPerSecond: 1,      // single inserts: at least 1 ops/sec (baseline ~22)
    maxAvgMs: 3000,          // catastrophe-only: avg insert under 3s (baseline ~46ms)
  },
  search: {
    minOpsPerSecond: 1,      // keyword search: at least 1 ops/sec (baseline ~59)
    maxAvgMs: 3000,          // catastrophe-only: avg search under 3s (baseline ~17ms)
  },
  batch: {
    minOpsPerSecond: 2,      // batch inserts: at least 2 ops/sec (baseline ~77)
    maxAvgMs: 2000,          // catastrophe-only: avg per-event under 2s (baseline ~13ms)
  },
  concurrent: {
    minOpsPerSecond: 2,      // concurrent r/w: at least 2 ops/sec (baseline ~90)
    maxP95Ms: 30000,         // catastrophe-only: P95 under 30s (baseline ~132ms)
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
  }, 300_000); // 5min timeout for full benchmark suite (needs headroom under concurrent load)

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
