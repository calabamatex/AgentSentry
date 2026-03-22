/**
 * benchmark.ts — Programmatic benchmark suite for the AgentOps memory system.
 * Measures insert throughput, search latency, batch vs single operations,
 * cache hit/miss ratio, and concurrent read/write performance.
 */

import { performance } from 'perf_hooks';
import * as os from 'os';
import { MemoryStore } from './store';
import { BatchProcessor } from './batch';
import {
  OpsEventInput,
  EVENT_TYPES,
  SEVERITIES,
  SKILLS,
} from './schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  opsPerSecond: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkReport {
  timestamp: string;
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpus: number;
    memoryMb: number;
  };
  results: BenchmarkResult[];
  totalTimeMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTestEvent(index: number): OpsEventInput {
  return {
    timestamp: new Date().toISOString(),
    session_id: `bench-sess-${index % 10}`,
    agent_id: `bench-agent-${index % 5}`,
    event_type: EVENT_TYPES[index % EVENT_TYPES.length],
    severity: SEVERITIES[index % SEVERITIES.length],
    skill: SKILLS[index % SKILLS.length],
    title: `Benchmark event ${index}`,
    detail: `Benchmark detail for event number ${index}`,
    affected_files: [`src/file-${index}.ts`],
    tags: ['benchmark'],
    metadata: { index },
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function collectSystemInfo(): BenchmarkReport['system'] {
  return {
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    memoryMb: Math.round(os.totalmem() / (1024 * 1024)),
  };
}

// ---------------------------------------------------------------------------
// BenchmarkSuite
// ---------------------------------------------------------------------------

export class BenchmarkSuite {
  private readonly store: MemoryStore;
  private readonly iterations: number;

  constructor(options: { store: MemoryStore; iterations?: number }) {
    this.store = options.store;
    this.iterations = options.iterations ?? 1000;
  }

  /**
   * Runs all benchmarks and returns a complete report.
   */
  async runAll(): Promise<BenchmarkReport> {
    const suiteStart = performance.now();

    const results: BenchmarkResult[] = [];

    results.push(await this.benchmarkInsert());
    results.push(await this.benchmarkSearch());
    results.push(await this.benchmarkBatchInsert());
    results.push(await this.benchmarkCachePerformance());
    results.push(await this.benchmarkConcurrentReadWrite());

    const totalTimeMs = performance.now() - suiteStart;

    return {
      timestamp: new Date().toISOString(),
      system: collectSystemInfo(),
      results,
      totalTimeMs,
    };
  }

  /**
   * Measures single insert throughput (events/sec).
   */
  async benchmarkInsert(count?: number): Promise<BenchmarkResult> {
    const n = count ?? this.iterations;
    const timings: number[] = [];

    for (let i = 0; i < n; i++) {
      const event = generateTestEvent(i);
      const start = performance.now();
      await this.store.capture(event);
      timings.push(performance.now() - start);
    }

    return this.buildResult('Insert (single)', timings);
  }

  /**
   * Measures search latency (avg, p50, p95, p99).
   */
  async benchmarkSearch(queries?: string[]): Promise<BenchmarkResult> {
    const defaultQueries = [
      'Benchmark event',
      'detail for event',
      'file-1',
      'bench-sess',
      'nonexistent query',
    ];
    const searchQueries = queries ?? defaultQueries;

    // Seed some data so searches have something to find
    const seedCount = Math.min(100, this.iterations);
    for (let i = 0; i < seedCount; i++) {
      await this.store.capture(generateTestEvent(i));
    }

    const totalRuns = this.iterations;
    const timings: number[] = [];

    for (let i = 0; i < totalRuns; i++) {
      const query = searchQueries[i % searchQueries.length];
      const start = performance.now();
      await this.store.search(query, { limit: 10 });
      timings.push(performance.now() - start);
    }

    return this.buildResult('Search (keyword)', timings);
  }

  /**
   * Measures batch insert throughput via BatchProcessor.
   */
  async benchmarkBatchInsert(count?: number, batchSize?: number): Promise<BenchmarkResult> {
    const n = count ?? this.iterations;
    const size = batchSize ?? 100;

    const inputs: OpsEventInput[] = [];
    for (let i = 0; i < n; i++) {
      inputs.push(generateTestEvent(i));
    }

    const processor = new BatchProcessor({ store: this.store, batchSize: size });

    const start = performance.now();
    const result = await processor.captureBatch(inputs);
    const totalTimeMs = performance.now() - start;

    const avgTimeMs = totalTimeMs / n;
    const opsPerSecond = n / (totalTimeMs / 1000);

    return {
      name: 'Insert (batch)',
      iterations: n,
      totalTimeMs,
      avgTimeMs,
      opsPerSecond,
      metadata: {
        batchSize: size,
        captured: result.captured.length,
        errors: result.errors.length,
      },
    };
  }

  /**
   * Measures cache hit/miss performance using CachedStorageProvider stats.
   */
  async benchmarkCachePerformance(hitRatio?: number): Promise<BenchmarkResult> {
    const n = this.iterations;
    const targetHitRatio = hitRatio ?? 0.8;

    // Seed data so searches return results
    const seedCount = Math.min(50, n);
    for (let i = 0; i < seedCount; i++) {
      await this.store.capture(generateTestEvent(i));
    }

    // Phase 1: Cold queries (cache misses)
    const coldTimings: number[] = [];
    const queryCount = Math.ceil(n * (1 - targetHitRatio));
    for (let i = 0; i < queryCount; i++) {
      const start = performance.now();
      await this.store.search(`Benchmark event ${i % seedCount}`, { limit: 5 });
      coldTimings.push(performance.now() - start);
    }

    // Phase 2: Repeat same queries (cache hits)
    const hotTimings: number[] = [];
    const hitCount = n - queryCount;
    for (let i = 0; i < hitCount; i++) {
      const start = performance.now();
      await this.store.search(`Benchmark event ${i % queryCount}`, { limit: 5 });
      hotTimings.push(performance.now() - start);
    }

    const allTimings = [...coldTimings, ...hotTimings];
    const result = this.buildResult('Cache (hit/miss)', allTimings);

    const coldAvg = coldTimings.length > 0
      ? coldTimings.reduce((a, b) => a + b, 0) / coldTimings.length
      : 0;
    const hotAvg = hotTimings.length > 0
      ? hotTimings.reduce((a, b) => a + b, 0) / hotTimings.length
      : 0;

    result.metadata = {
      coldQueries: coldTimings.length,
      hotQueries: hotTimings.length,
      coldAvgMs: Number(coldAvg.toFixed(4)),
      hotAvgMs: Number(hotAvg.toFixed(4)),
      speedup: coldAvg > 0 ? Number((coldAvg / Math.max(hotAvg, 0.001)).toFixed(2)) : 0,
    };

    return result;
  }

  /**
   * Measures concurrent read/write performance using Promise.all.
   */
  async benchmarkConcurrentReadWrite(
    readers?: number,
    writers?: number,
  ): Promise<BenchmarkResult> {
    const readerCount = readers ?? 5;
    const writerCount = writers ?? 5;
    const opsPerWorker = Math.ceil(this.iterations / (readerCount + writerCount));

    // Seed some data for readers
    const seedCount = Math.min(50, this.iterations);
    for (let i = 0; i < seedCount; i++) {
      await this.store.capture(generateTestEvent(i));
    }

    const timings: number[] = [];

    const writerTasks = Array.from({ length: writerCount }, async (_, w) => {
      const localTimings: number[] = [];
      for (let i = 0; i < opsPerWorker; i++) {
        const event = generateTestEvent(w * opsPerWorker + i + 10000);
        const start = performance.now();
        await this.store.capture(event);
        localTimings.push(performance.now() - start);
      }
      return localTimings;
    });

    const readerTasks = Array.from({ length: readerCount }, async (_, r) => {
      const localTimings: number[] = [];
      for (let i = 0; i < opsPerWorker; i++) {
        const query = `Benchmark event ${(r * opsPerWorker + i) % seedCount}`;
        const start = performance.now();
        await this.store.search(query, { limit: 5 });
        localTimings.push(performance.now() - start);
      }
      return localTimings;
    });

    const overallStart = performance.now();
    const allResults = await Promise.all([...writerTasks, ...readerTasks]);
    const overallTimeMs = performance.now() - overallStart;

    for (const localTimings of allResults) {
      timings.push(...localTimings);
    }

    const totalOps = timings.length;
    const sorted = [...timings].sort((a, b) => a - b);

    return {
      name: 'Concurrent R/W',
      iterations: totalOps,
      totalTimeMs: overallTimeMs,
      avgTimeMs: totalOps > 0 ? overallTimeMs / totalOps : 0,
      opsPerSecond: totalOps / (overallTimeMs / 1000),
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      metadata: {
        readers: readerCount,
        writers: writerCount,
        opsPerWorker,
        totalOps,
      },
    };
  }

  /**
   * Returns a human-readable ASCII table of the benchmark report.
   */
  formatReport(report: BenchmarkReport): string {
    const lines: string[] = [];
    const w = 62;

    lines.push(`\u2554${''.padEnd(w, '\u2550')}\u2557`);
    lines.push(`\u2551${'AgentOps Benchmark Report'.padStart(Math.ceil((w + 25) / 2)).padEnd(w)}\u2551`);
    lines.push(`\u2560${''.padEnd(w, '\u2550')}\u2563`);

    const hdrBenchmark = 'Benchmark'.padEnd(20);
    const hdrOps = 'Ops/sec'.padStart(10);
    const hdrAvg = 'Avg (ms)'.padStart(11);
    const hdrP95 = 'P95 (ms)'.padStart(15);
    lines.push(`\u2551 ${hdrBenchmark}\u2502${hdrOps} \u2502${hdrAvg} \u2502${hdrP95}   \u2551`);
    lines.push(`\u2560${''.padEnd(21, '\u2550')}\u256A${''.padEnd(11, '\u2550')}\u256A${''.padEnd(12, '\u2550')}\u256A${''.padEnd(w - 46, '\u2550')}\u2563`);

    for (const r of report.results) {
      const name = r.name.padEnd(20);
      const ops = formatNumber(Math.round(r.opsPerSecond)).padStart(10);
      const avg = r.avgTimeMs.toFixed(3).padStart(11);
      const p95 = r.p95Ms !== undefined ? r.p95Ms.toFixed(3).padStart(15) : 'N/A'.padStart(15);
      lines.push(`\u2551 ${name}\u2502${ops} \u2502${avg} \u2502${p95}   \u2551`);
    }

    lines.push(`\u255A${''.padEnd(w, '\u2550')}\u255D`);

    lines.push('');
    lines.push(`System: Node ${report.system.nodeVersion} | ${report.system.platform}/${report.system.arch} | ${report.system.cpus} CPUs | ${report.system.memoryMb} MB RAM`);
    lines.push(`Total time: ${report.totalTimeMs.toFixed(1)} ms`);
    lines.push(`Timestamp: ${report.timestamp}`);

    return lines.join('\n');
  }

  /**
   * Returns the benchmark report as a JSON string.
   */
  toJSON(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildResult(name: string, timings: number[]): BenchmarkResult {
    const n = timings.length;
    if (n === 0) {
      return {
        name,
        iterations: 0,
        totalTimeMs: 0,
        avgTimeMs: 0,
        opsPerSecond: 0,
      };
    }

    const totalTimeMs = timings.reduce((a, b) => a + b, 0);
    const avgTimeMs = totalTimeMs / n;
    const opsPerSecond = n / (totalTimeMs / 1000);
    const sorted = [...timings].sort((a, b) => a - b);

    return {
      name,
      iterations: n,
      totalTimeMs,
      avgTimeMs,
      opsPerSecond,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
    };
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
