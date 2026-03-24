import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { BenchmarkSuite } from '../../src/memory/benchmark';

const TEST_DB = path.resolve(__dirname, '../fixtures/test-benchmark.db');

describe('BenchmarkSuite', () => {
  let store: MemoryStore;
  let suite: BenchmarkSuite;

  beforeEach(async () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

    store = new MemoryStore({
      provider: new SqliteProvider(TEST_DB),
      embeddingProvider: new NoopEmbeddingProvider(),
    });
    await store.initialize();

    suite = new BenchmarkSuite({ store, iterations: 10 });
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  // -------------------------------------------------------------------------
  // benchmarkInsert
  // -------------------------------------------------------------------------

  describe('benchmarkInsert()', () => {
    it('returns valid BenchmarkResult with opsPerSecond > 0', async () => {
      const result = await suite.benchmarkInsert();

      expect(result.name).toBe('Insert (single)');
      expect(result.opsPerSecond).toBeGreaterThan(0);
      expect(result.totalTimeMs).toBeGreaterThan(0);
      expect(result.avgTimeMs).toBeGreaterThan(0);
    });

    it('returns correct iteration count', async () => {
      const result = await suite.benchmarkInsert();

      expect(result.iterations).toBe(10);
    });

    it('includes p50, p95, p99 values', async () => {
      const result = await suite.benchmarkInsert();

      expect(result.p50Ms).toBeDefined();
      expect(result.p95Ms).toBeDefined();
      expect(result.p99Ms).toBeDefined();
      expect(result.p50Ms).toBeGreaterThanOrEqual(0);
      expect(result.p95Ms).toBeGreaterThanOrEqual(0);
      expect(result.p99Ms).toBeGreaterThanOrEqual(0);
      // p50 <= p95 <= p99 (sorted percentiles)
      expect(result.p95Ms!).toBeGreaterThanOrEqual(result.p50Ms!);
      expect(result.p99Ms!).toBeGreaterThanOrEqual(result.p95Ms!);
    });
  });

  // -------------------------------------------------------------------------
  // benchmarkSearch
  // -------------------------------------------------------------------------

  describe('benchmarkSearch()', () => {
    it('returns results with timing data', async () => {
      const result = await suite.benchmarkSearch();

      expect(result.name).toBe('Search (keyword)');
      expect(result.iterations).toBe(10);
      expect(result.totalTimeMs).toBeGreaterThan(0);
      expect(result.avgTimeMs).toBeGreaterThan(0);
      expect(result.opsPerSecond).toBeGreaterThan(0);
    });

    it('includes percentile data', async () => {
      const result = await suite.benchmarkSearch();

      expect(result.p50Ms).toBeDefined();
      expect(result.p95Ms).toBeDefined();
      expect(result.p99Ms).toBeDefined();
      expect(typeof result.p50Ms).toBe('number');
      expect(typeof result.p95Ms).toBe('number');
      expect(typeof result.p99Ms).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // benchmarkBatchInsert
  // -------------------------------------------------------------------------

  describe('benchmarkBatchInsert()', () => {
    it('returns result with metadata including batchSize and captured count', async () => {
      const result = await suite.benchmarkBatchInsert(10, 5);

      expect(result.name).toBe('Insert (batch)');
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.batchSize).toBe(5);
      expect(result.metadata!.captured).toBe(10);
      expect(result.metadata!.errors).toBe(0);
    });

    it('has opsPerSecond > 0', async () => {
      const result = await suite.benchmarkBatchInsert(10, 5);

      expect(result.opsPerSecond).toBeGreaterThan(0);
      expect(result.iterations).toBe(10);
      expect(result.totalTimeMs).toBeGreaterThan(0);
      expect(result.avgTimeMs).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // benchmarkCachePerformance
  // -------------------------------------------------------------------------

  describe('benchmarkCachePerformance()', () => {
    it('returns result with metadata including coldAvgMs and hotAvgMs', async () => {
      const result = await suite.benchmarkCachePerformance();

      expect(result.name).toBe('Cache (hit/miss)');
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.coldAvgMs).toBeDefined();
      expect(result.metadata!.hotAvgMs).toBeDefined();
      expect(typeof result.metadata!.coldAvgMs).toBe('number');
      expect(typeof result.metadata!.hotAvgMs).toBe('number');
      expect(result.metadata!.coldQueries).toBeGreaterThan(0);
      expect(result.metadata!.hotQueries).toBeGreaterThan(0);
      expect(result.metadata!.speedup).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // benchmarkConcurrentReadWrite
  // -------------------------------------------------------------------------

  describe('benchmarkConcurrentReadWrite()', () => {
    it('returns result with metadata for readers and writers', async () => {
      const result = await suite.benchmarkConcurrentReadWrite(2, 2);

      expect(result.name).toBe('Concurrent R/W');
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.readers).toBe(2);
      expect(result.metadata!.writers).toBe(2);
      expect(result.metadata!.opsPerWorker).toBeGreaterThan(0);
      expect(result.metadata!.totalOps).toBeGreaterThan(0);
    });

    it('iterations matches total ops across all workers', async () => {
      const readers = 2;
      const writers = 3;
      const result = await suite.benchmarkConcurrentReadWrite(readers, writers);

      // iterations should equal totalOps which is (readers + writers) * opsPerWorker
      expect(result.iterations).toBe(result.metadata!.totalOps);
      const opsPerWorker = result.metadata!.opsPerWorker as number;
      expect(result.iterations).toBe((readers + writers) * opsPerWorker);
    });
  });

  // -------------------------------------------------------------------------
  // formatReport
  // -------------------------------------------------------------------------

  describe('formatReport()', () => {
    it('returns non-empty string containing table characters', async () => {
      const report = await suite.runAll();
      const formatted = suite.formatReport(report);

      expect(formatted.length).toBeGreaterThan(0);
      // Should contain Unicode box-drawing characters
      expect(formatted).toContain('\u2554'); // top-left corner
      expect(formatted).toContain('\u2550'); // horizontal line
      expect(formatted).toContain('\u2551'); // vertical line
      expect(formatted).toContain('\u255A'); // bottom-left corner
      // Should contain header text
      expect(formatted).toContain('AgentSentry Benchmark Report');
      expect(formatted).toContain('Ops/sec');
      expect(formatted).toContain('Avg (ms)');
      expect(formatted).toContain('P95 (ms)');
      // Should contain system info
      expect(formatted).toContain('System:');
      expect(formatted).toContain('Total time:');
    });
  });

  // -------------------------------------------------------------------------
  // toJSON
  // -------------------------------------------------------------------------

  describe('toJSON()', () => {
    it('returns valid JSON string', async () => {
      const report = await suite.runAll();
      const jsonStr = suite.toJSON(report);

      expect(typeof jsonStr).toBe('string');
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('system');
      expect(parsed).toHaveProperty('results');
      expect(parsed).toHaveProperty('totalTimeMs');
    });
  });

  // -------------------------------------------------------------------------
  // runAll
  // -------------------------------------------------------------------------

  describe('runAll()', () => {
    it('returns complete report with system info and 5 results', async () => {
      const report = await suite.runAll();

      // System info
      expect(report.system).toBeDefined();
      expect(report.system.nodeVersion).toMatch(/^v\d+/);
      expect(typeof report.system.platform).toBe('string');
      expect(typeof report.system.arch).toBe('string');
      expect(report.system.cpus).toBeGreaterThan(0);
      expect(report.system.memoryMb).toBeGreaterThan(0);

      // Timestamp
      expect(report.timestamp).toBeTruthy();
      expect(() => new Date(report.timestamp)).not.toThrow();

      // Total time
      expect(report.totalTimeMs).toBeGreaterThan(0);

      // Should have exactly 5 benchmark results
      expect(report.results).toHaveLength(5);

      const names = report.results.map((r) => r.name);
      expect(names).toContain('Insert (single)');
      expect(names).toContain('Search (keyword)');
      expect(names).toContain('Insert (batch)');
      expect(names).toContain('Cache (hit/miss)');
      expect(names).toContain('Concurrent R/W');

      // Every result should have positive ops/sec
      for (const r of report.results) {
        expect(r.opsPerSecond).toBeGreaterThan(0);
        expect(r.iterations).toBeGreaterThan(0);
      }
    });
  });
});
