/**
 * metrics.ts — Metrics collector with Prometheus text format output.
 * Zero external dependencies — uses only Node built-in http types.
 */

import type { IncomingMessage, ServerResponse } from 'http';

/** Snapshot of histogram state at a point in time. */
export interface HistogramSnapshot {
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  buckets: Array<{ le: number; count: number }>;
}

type MetricType = 'counter' | 'gauge' | 'histogram';

interface MetricMeta {
  name: string;
  help: string;
  type: MetricType;
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/** Encode labels into a Prometheus label string like {key="val",key2="val2"} */
function labelKey(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`);
  return `{${parts.join(',')}}`;
}

/** Compute percentile using nearest-rank method on a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

/**
 * MetricsCollector — singleton that collects counters, gauges, and histograms
 * and exports them in Prometheus text exposition format.
 */
export class MetricsCollector {
  private static instance: MetricsCollector | undefined;

  private readonly metas = new Map<string, MetricMeta>();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histogramValues = new Map<string, number[]>();
  private readonly histogramBuckets = new Map<string, number[]>();

  private constructor() {}

  /** Return the singleton instance, creating it if necessary. */
  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /** Destroy the singleton so a fresh instance is created next time. */
  static reset(): void {
    MetricsCollector.instance = undefined;
  }

  // ---- Registration ----

  /** Register a counter metric. */
  counter(name: string, help: string, _labels?: Record<string, string>): void {
    this.registerMetric(name, help, 'counter');
  }

  /** Register a gauge metric. */
  gauge(name: string, help: string): void {
    this.registerMetric(name, help, 'gauge');
  }

  /** Register a histogram metric with optional custom buckets. */
  histogram(name: string, help: string, buckets?: number[]): void {
    this.registerMetric(name, help, 'histogram');
    if (!this.histogramBuckets.has(name)) {
      this.histogramBuckets.set(name, buckets ? [...buckets].sort((a, b) => a - b) : [...DEFAULT_BUCKETS]);
    }
  }

  // ---- Counter operations ----

  /** Increment a counter by value (default 1). */
  increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    this.assertRegistered(name, 'counter');
    const key = name + labelKey(labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  /** Get current counter value. */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = name + labelKey(labels);
    return this.counters.get(key) ?? 0;
  }

  // ---- Gauge operations ----

  /** Set a gauge to a specific value. */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    this.assertRegistered(name, 'gauge');
    const key = name + labelKey(labels);
    this.gauges.set(key, value);
  }

  /** Get current gauge value. */
  getGauge(name: string, labels?: Record<string, string>): number {
    const key = name + labelKey(labels);
    return this.gauges.get(key) ?? 0;
  }

  // ---- Histogram operations ----

  /** Record an observation in a histogram. */
  observe(name: string, value: number, labels?: Record<string, string>): void {
    this.assertRegistered(name, 'histogram');
    const key = name + labelKey(labels);
    const arr = this.histogramValues.get(key) ?? [];
    arr.push(value);
    this.histogramValues.set(key, arr);
  }

  /** Get a snapshot of a histogram's state. */
  getHistogram(name: string, labels?: Record<string, string>): HistogramSnapshot {
    const key = name + labelKey(labels);
    const values = this.histogramValues.get(key) ?? [];
    const bucketDefs = this.histogramBuckets.get(name) ?? DEFAULT_BUCKETS;

    if (values.length === 0) {
      return {
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        buckets: bucketDefs.map((le) => ({ le, count: 0 })),
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      buckets: bucketDefs.map((le) => ({
        le,
        count: sorted.filter((v) => v <= le).length,
      })),
    };
  }

  // ---- Timer ----

  /** Start a timer that observes elapsed ms into the named histogram when stopped. */
  startTimer(name: string, labels?: Record<string, string>): () => number {
    const start = Date.now();
    return () => {
      const elapsed = Date.now() - start;
      this.observe(name, elapsed, labels);
      return elapsed;
    };
  }

  // ---- Prometheus output ----

  /** Render all metrics in Prometheus text exposition format. */
  toPrometheus(): string {
    const lines: string[] = [];
    const emittedHeaders = new Set<string>();

    const emitHeader = (meta: MetricMeta) => {
      if (emittedHeaders.has(meta.name)) return;
      emittedHeaders.add(meta.name);
      lines.push(`# HELP ${meta.name} ${meta.help}`);
      lines.push(`# TYPE ${meta.name} ${meta.type}`);
    };

    // Counters
    for (const [key, value] of this.counters) {
      const name = this.extractName(key);
      const meta = this.metas.get(name);
      if (!meta) continue;
      emitHeader(meta);
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      const name = this.extractName(key);
      const meta = this.metas.get(name);
      if (!meta) continue;
      emitHeader(meta);
      lines.push(`${key} ${value}`);
    }

    // Histograms
    for (const [key] of this.histogramValues) {
      const name = this.extractName(key);
      const meta = this.metas.get(name);
      if (!meta) continue;
      emitHeader(meta);

      const labelSuffix = key.slice(name.length); // e.g. {method="GET"}
      const snapshot = this.getHistogramForKey(name, key);

      const bucketDefs = this.histogramBuckets.get(name) ?? DEFAULT_BUCKETS;
      for (const b of bucketDefs) {
        const count = snapshot.values.filter((v) => v <= b).length;
        lines.push(`${name}_bucket${this.mergeBucketLabel(labelSuffix, b)} ${count}`);
      }
      lines.push(`${name}_bucket${this.mergeBucketLabel(labelSuffix, Infinity)} ${snapshot.values.length}`);
      lines.push(`${name}_sum${labelSuffix} ${snapshot.sum}`);
      lines.push(`${name}_count${labelSuffix} ${snapshot.values.length}`);
    }

    return lines.join('\n') + '\n';
  }

  // ---- Private helpers ----

  private registerMetric(name: string, help: string, type: MetricType): void {
    const existing = this.metas.get(name);
    if (existing) {
      if (existing.type !== type) {
        throw new Error(`Metric "${name}" already registered as ${existing.type}, cannot re-register as ${type}`);
      }
      // Idempotent: same name + same type is fine
      return;
    }
    this.metas.set(name, { name, help, type });
  }

  private assertRegistered(name: string, expectedType: MetricType): void {
    const meta = this.metas.get(name);
    if (!meta) {
      throw new Error(`Metric "${name}" is not registered. Call ${expectedType}() first.`);
    }
    if (meta.type !== expectedType) {
      throw new Error(`Metric "${name}" is a ${meta.type}, not a ${expectedType}`);
    }
  }

  /** Extract the metric name from a key that may have label suffixes. */
  private extractName(key: string): string {
    const idx = key.indexOf('{');
    return idx === -1 ? key : key.slice(0, idx);
  }

  /** Get raw histogram data for a full key. */
  private getHistogramForKey(name: string, key: string): { values: number[]; sum: number } {
    const values = this.histogramValues.get(key) ?? [];
    return { values, sum: values.reduce((a, b) => a + b, 0) };
  }

  /** Merge an existing label suffix with a le= bucket label. */
  private mergeBucketLabel(labelSuffix: string, le: number): string {
    const leStr = le === Infinity ? '+Inf' : String(le);
    if (!labelSuffix) {
      return `{le="${leStr}"}`;
    }
    // labelSuffix looks like {key="val"} — insert le before closing brace
    return `{le="${leStr}",${labelSuffix.slice(1)}`;
  }
}

/**
 * Create an HTTP middleware that serves Prometheus metrics on GET /metrics.
 * Returns true if the request was handled, false otherwise.
 */
export function createMetricsMiddleware(
  collector: MetricsCollector,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      return false;
    }
    const body = collector.toPrometheus();
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
    return true;
  };
}
