/**
 * Tests for observability/metrics — MetricsCollector with Prometheus output.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MetricsCollector,
  createMetricsMiddleware,
  type HistogramSnapshot,
} from '../../src/observability/metrics';
import type { IncomingMessage, ServerResponse } from 'http';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    MetricsCollector.reset();
    collector = MetricsCollector.getInstance();
  });

  // ---- Singleton ----

  describe('singleton', () => {
    it('should return the same instance from getInstance()', () => {
      const a = MetricsCollector.getInstance();
      const b = MetricsCollector.getInstance();
      expect(a).toBe(b);
    });

    it('should return a fresh instance after reset()', () => {
      const a = MetricsCollector.getInstance();
      MetricsCollector.reset();
      const b = MetricsCollector.getInstance();
      expect(a).not.toBe(b);
    });

    it('should clear all metrics on reset()', () => {
      collector.counter('reset_test', 'test');
      collector.increment('reset_test', 5);
      expect(collector.getCounter('reset_test')).toBe(5);

      MetricsCollector.reset();
      const fresh = MetricsCollector.getInstance();
      expect(fresh.getCounter('reset_test')).toBe(0);
    });
  });

  // ---- Counter ----

  describe('counter', () => {
    it('should increment a counter by 1 by default', () => {
      collector.counter('http_requests_total', 'Total HTTP requests');
      collector.increment('http_requests_total');
      expect(collector.getCounter('http_requests_total')).toBe(1);
    });

    it('should increment a counter by a custom value', () => {
      collector.counter('bytes_total', 'Total bytes');
      collector.increment('bytes_total', 42);
      expect(collector.getCounter('bytes_total')).toBe(42);
    });

    it('should accumulate multiple increments', () => {
      collector.counter('hits', 'Hit count');
      collector.increment('hits', 3);
      collector.increment('hits', 7);
      expect(collector.getCounter('hits')).toBe(10);
    });

    it('should return 0 for an unobserved counter', () => {
      collector.counter('empty', 'Empty counter');
      expect(collector.getCounter('empty')).toBe(0);
    });

    it('should track counters with different labels independently', () => {
      collector.counter('http_requests_total', 'Total HTTP requests');
      collector.increment('http_requests_total', 1, { method: 'GET' });
      collector.increment('http_requests_total', 2, { method: 'POST' });
      collector.increment('http_requests_total', 3, { method: 'GET' });

      expect(collector.getCounter('http_requests_total', { method: 'GET' })).toBe(4);
      expect(collector.getCounter('http_requests_total', { method: 'POST' })).toBe(2);
    });

    it('should throw when incrementing an unregistered counter', () => {
      expect(() => collector.increment('nope')).toThrow(/not registered/);
    });
  });

  // ---- Gauge ----

  describe('gauge', () => {
    it('should set and get a gauge value', () => {
      collector.gauge('temperature', 'Current temperature');
      collector.setGauge('temperature', 22.5);
      expect(collector.getGauge('temperature')).toBe(22.5);
    });

    it('should overwrite a gauge on subsequent sets', () => {
      collector.gauge('active_connections', 'Connections');
      collector.setGauge('active_connections', 10);
      collector.setGauge('active_connections', 5);
      expect(collector.getGauge('active_connections')).toBe(5);
    });

    it('should return 0 for an unobserved gauge', () => {
      collector.gauge('empty_gauge', 'Empty');
      expect(collector.getGauge('empty_gauge')).toBe(0);
    });

    it('should track gauges with different labels independently', () => {
      collector.gauge('cpu_usage', 'CPU usage');
      collector.setGauge('cpu_usage', 0.8, { core: '0' });
      collector.setGauge('cpu_usage', 0.4, { core: '1' });

      expect(collector.getGauge('cpu_usage', { core: '0' })).toBe(0.8);
      expect(collector.getGauge('cpu_usage', { core: '1' })).toBe(0.4);
    });

    it('should throw when setting an unregistered gauge', () => {
      expect(() => collector.setGauge('nope', 1)).toThrow(/not registered/);
    });
  });

  // ---- Histogram ----

  describe('histogram', () => {
    it('should use default buckets when none provided', () => {
      collector.histogram('latency', 'Request latency');
      collector.observe('latency', 50);
      const snap = collector.getHistogram('latency');
      expect(snap.buckets.map((b) => b.le)).toEqual([
        5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
      ]);
    });

    it('should use custom buckets when provided', () => {
      collector.histogram('custom', 'Custom', [10, 50, 100]);
      collector.observe('custom', 25);
      const snap = collector.getHistogram('custom');
      expect(snap.buckets.map((b) => b.le)).toEqual([10, 50, 100]);
    });

    it('should compute count, sum, min, max, avg', () => {
      collector.histogram('dur', 'Duration');
      [10, 20, 30, 40, 50].forEach((v) => collector.observe('dur', v));

      const snap = collector.getHistogram('dur');
      expect(snap.count).toBe(5);
      expect(snap.sum).toBe(150);
      expect(snap.min).toBe(10);
      expect(snap.max).toBe(50);
      expect(snap.avg).toBe(30);
    });

    it('should compute bucket counts correctly', () => {
      collector.histogram('bkt', 'Buckets', [10, 50, 100]);
      [5, 15, 55, 80].forEach((v) => collector.observe('bkt', v));

      const snap = collector.getHistogram('bkt');
      expect(snap.buckets).toEqual([
        { le: 10, count: 1 },
        { le: 50, count: 2 },
        { le: 100, count: 4 },
      ]);
    });

    it('should compute percentiles with known data (p50, p95, p99)', () => {
      collector.histogram('perc', 'Percentiles');
      // Values 1..100
      for (let i = 1; i <= 100; i++) {
        collector.observe('perc', i);
      }
      const snap = collector.getHistogram('perc');
      expect(snap.p50).toBe(50);
      expect(snap.p90).toBe(90);
      expect(snap.p95).toBe(95);
      expect(snap.p99).toBe(99);
    });

    it('should return zero snapshot for unobserved histogram', () => {
      collector.histogram('empty_hist', 'Empty');
      const snap = collector.getHistogram('empty_hist');
      expect(snap.count).toBe(0);
      expect(snap.sum).toBe(0);
      expect(snap.min).toBe(0);
      expect(snap.max).toBe(0);
      expect(snap.avg).toBe(0);
      expect(snap.p50).toBe(0);
    });

    it('should track histograms with different labels independently', () => {
      collector.histogram('req_duration', 'Duration');
      collector.observe('req_duration', 10, { endpoint: '/a' });
      collector.observe('req_duration', 100, { endpoint: '/b' });

      const snapA = collector.getHistogram('req_duration', { endpoint: '/a' });
      const snapB = collector.getHistogram('req_duration', { endpoint: '/b' });
      expect(snapA.sum).toBe(10);
      expect(snapB.sum).toBe(100);
    });
  });

  // ---- Registration ----

  describe('registration', () => {
    it('should be idempotent for same name and type', () => {
      collector.counter('dup', 'first');
      expect(() => collector.counter('dup', 'second')).not.toThrow();
    });

    it('should throw when re-registering with a different type', () => {
      collector.counter('conflict', 'A counter');
      expect(() => collector.gauge('conflict', 'A gauge')).toThrow(/already registered/);
    });
  });

  // ---- Timer ----

  describe('startTimer', () => {
    it('should record elapsed time in the histogram', () => {
      collector.histogram('timer_test', 'Timer test');

      const now = Date.now;
      let clock = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => clock);

      const stop = collector.startTimer('timer_test');
      clock = 1050; // 50ms later
      const elapsed = stop();

      expect(elapsed).toBe(50);
      const snap = collector.getHistogram('timer_test');
      expect(snap.count).toBe(1);
      expect(snap.sum).toBe(50);

      vi.restoreAllMocks();
    });
  });

  // ---- Prometheus output ----

  describe('toPrometheus', () => {
    it('should output counter in Prometheus format', () => {
      collector.counter('my_counter', 'A helpful counter');
      collector.increment('my_counter', 5);

      const output = collector.toPrometheus();
      expect(output).toContain('# HELP my_counter A helpful counter');
      expect(output).toContain('# TYPE my_counter counter');
      expect(output).toContain('my_counter 5');
    });

    it('should output gauge in Prometheus format', () => {
      collector.gauge('my_gauge', 'A helpful gauge');
      collector.setGauge('my_gauge', 42);

      const output = collector.toPrometheus();
      expect(output).toContain('# HELP my_gauge A helpful gauge');
      expect(output).toContain('# TYPE my_gauge gauge');
      expect(output).toContain('my_gauge 42');
    });

    it('should output histogram in Prometheus format', () => {
      collector.histogram('req_dur', 'Request duration', [10, 50, 100]);
      collector.observe('req_dur', 25);
      collector.observe('req_dur', 75);

      const output = collector.toPrometheus();
      expect(output).toContain('# HELP req_dur Request duration');
      expect(output).toContain('# TYPE req_dur histogram');
      expect(output).toContain('req_dur_bucket{le="10"} 0');
      expect(output).toContain('req_dur_bucket{le="50"} 1');
      expect(output).toContain('req_dur_bucket{le="100"} 2');
      expect(output).toContain('req_dur_bucket{le="+Inf"} 2');
      expect(output).toContain('req_dur_sum 100');
      expect(output).toContain('req_dur_count 2');
    });

    it('should include labels in Prometheus output', () => {
      collector.counter('labeled', 'Labeled counter');
      collector.increment('labeled', 3, { method: 'GET', status: '200' });

      const output = collector.toPrometheus();
      expect(output).toContain('labeled{method="GET",status="200"} 3');
    });

    it('should include labels in histogram bucket output', () => {
      collector.histogram('hist_labeled', 'Labeled histogram', [10, 100]);
      collector.observe('hist_labeled', 5, { route: '/api' });

      const output = collector.toPrometheus();
      expect(output).toContain('hist_labeled_bucket{le="10",route="/api"} 1');
      expect(output).toContain('hist_labeled_bucket{le="100",route="/api"} 1');
      expect(output).toContain('hist_labeled_bucket{le="+Inf",route="/api"} 1');
    });

    it('should end with a newline', () => {
      collector.counter('nl', 'newline test');
      collector.increment('nl');
      expect(collector.toPrometheus().endsWith('\n')).toBe(true);
    });
  });
});

// ---- Middleware ----

describe('createMetricsMiddleware', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    MetricsCollector.reset();
    collector = MetricsCollector.getInstance();
  });

  function mockReqRes(method: string, url: string) {
    const req = { method, url } as IncomingMessage;
    const chunks: Buffer[] = [];
    let statusCode = 0;
    let headers: Record<string, string | number> = {};
    const res = {
      writeHead: (code: number, h: Record<string, string | number>) => {
        statusCode = code;
        headers = h;
      },
      end: (body: string) => {
        chunks.push(Buffer.from(body));
      },
    } as unknown as ServerResponse;
    return {
      req,
      res,
      getStatus: () => statusCode,
      getHeaders: () => headers,
      getBody: () => Buffer.concat(chunks).toString(),
    };
  }

  it('should handle GET /metrics and return Prometheus output', () => {
    collector.counter('test_counter', 'Test');
    collector.increment('test_counter', 7);

    const middleware = createMetricsMiddleware(collector);
    const { req, res, getStatus, getHeaders, getBody } = mockReqRes('GET', '/metrics');

    const handled = middleware(req, res);
    expect(handled).toBe(true);
    expect(getStatus()).toBe(200);
    expect(getHeaders()['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(getBody()).toContain('test_counter 7');
  });

  it('should return false for non-matching URL', () => {
    const middleware = createMetricsMiddleware(collector);
    const { req, res } = mockReqRes('GET', '/health');

    expect(middleware(req, res)).toBe(false);
  });

  it('should return false for non-GET method on /metrics', () => {
    const middleware = createMetricsMiddleware(collector);
    const { req, res } = mockReqRes('POST', '/metrics');

    expect(middleware(req, res)).toBe(false);
  });
});
