import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HealthChecker,
  HealthCheckResult,
  ComponentCheck,
  createHealthMiddleware,
  memoryUsageCheck,
  eventLoopCheck,
} from '../../src/observability/health';

/** Helper to create a mock HTTP request. */
function mockReq(method: string, url: string) {
  return { method, url } as { method: string; url: string };
}

/** Helper to create a mock HTTP response that captures output. */
function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
      res.statusCode = code;
      if (headers) res.headers = headers;
    }),
    end: vi.fn((body?: string) => {
      res.body = body ?? '';
    }),
  };
  return res;
}

/** Wait a tick for async middleware to settle. */
function tick(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('HealthChecker', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker({ version: '1.2.3' });
  });

  // --- Liveness ---

  it('liveness always returns ok', async () => {
    const result = await checker.liveness();
    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeTruthy();
  });

  // --- Readiness: no checks ---

  it('readiness with no checks returns healthy', async () => {
    const result = await checker.readiness();
    expect(result.status).toBe('healthy');
    expect(result.checks).toEqual({});
    expect(result.version).toBe('1.2.3');
  });

  // --- Readiness: all passing ---

  it('readiness with all passing checks returns healthy', async () => {
    checker.registerCheck('db', async () => ({ status: 'pass', message: 'ok' }));
    checker.registerCheck('cache', async () => ({ status: 'pass', message: 'ok' }));

    const result = await checker.readiness();
    expect(result.status).toBe('healthy');
    expect(result.checks['db'].status).toBe('pass');
    expect(result.checks['cache'].status).toBe('pass');
  });

  // --- Readiness: warn check ---

  it('readiness with a warn check returns degraded', async () => {
    checker.registerCheck('db', async () => ({ status: 'pass' }));
    checker.registerCheck('cache', async () => ({ status: 'warn', message: 'high latency' }));

    const result = await checker.readiness();
    expect(result.status).toBe('degraded');
  });

  // --- Readiness: fail check ---

  it('readiness with a fail check returns unhealthy', async () => {
    checker.registerCheck('db', async () => ({ status: 'fail', message: 'connection refused' }));
    checker.registerCheck('cache', async () => ({ status: 'pass' }));

    const result = await checker.readiness();
    expect(result.status).toBe('unhealthy');
  });

  // --- Readiness: throwing check treated as fail ---

  it('readiness treats a throwing check as fail', async () => {
    checker.registerCheck('broken', async () => {
      throw new Error('unexpected failure');
    });

    const result = await checker.readiness();
    expect(result.status).toBe('unhealthy');
    expect(result.checks['broken'].status).toBe('fail');
    expect(result.checks['broken'].message).toContain('unexpected failure');
  });

  // --- registerCheck / removeCheck ---

  it('registerCheck and removeCheck manage checks', () => {
    checker.registerCheck('a', async () => ({ status: 'pass' }));
    checker.registerCheck('b', async () => ({ status: 'pass' }));
    expect(checker.getRegisteredChecks()).toEqual(['a', 'b']);

    checker.removeCheck('a');
    expect(checker.getRegisteredChecks()).toEqual(['b']);
  });

  // --- getRegisteredChecks ---

  it('getRegisteredChecks returns empty list initially', () => {
    expect(checker.getRegisteredChecks()).toEqual([]);
  });

  // --- Uptime ---

  it('uptime increases over time', async () => {
    const t1 = checker.getUptime();
    await new Promise((r) => setTimeout(r, 50));
    const t2 = checker.getUptime();
    expect(t2).toBeGreaterThan(t1);
  });

  // --- Version in readiness ---

  it('includes version in readiness response', async () => {
    const result = await checker.readiness();
    expect(result.version).toBe('1.2.3');
  });

  // --- Default version ---

  it('uses default version 0.0.0 when not specified', async () => {
    const defaultChecker = new HealthChecker();
    const result = await defaultChecker.readiness();
    expect(result.version).toBe('0.0.0');
  });
});

describe('createHealthMiddleware', () => {
  let checker: HealthChecker;

  beforeEach(() => {
    checker = new HealthChecker({ version: '2.0.0' });
  });

  it('handles GET /healthz and returns 200', async () => {
    const mw = createHealthMiddleware(checker);
    const req = mockReq('GET', '/healthz');
    const res = mockRes();

    const handled = mw(req as any, res as any);
    expect(handled).toBe(true);

    await tick();
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  it('handles GET /readyz and returns 200 when healthy', async () => {
    checker.registerCheck('ok', async () => ({ status: 'pass' }));
    const mw = createHealthMiddleware(checker);
    const req = mockReq('GET', '/readyz');
    const res = mockRes();

    const handled = mw(req as any, res as any);
    expect(handled).toBe(true);

    await tick();
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const body = JSON.parse(res.body) as HealthCheckResult;
    expect(body.status).toBe('healthy');
  });

  it('handles GET /readyz and returns 503 when unhealthy', async () => {
    checker.registerCheck('bad', async () => ({ status: 'fail', message: 'down' }));
    const mw = createHealthMiddleware(checker);
    const req = mockReq('GET', '/readyz');
    const res = mockRes();

    const handled = mw(req as any, res as any);
    expect(handled).toBe(true);

    await tick();
    expect(res.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
  });

  it('returns false for unmatched routes', () => {
    const mw = createHealthMiddleware(checker);
    const res = mockRes();

    expect(mw(mockReq('GET', '/other') as any, res as any)).toBe(false);
    expect(mw(mockReq('POST', '/healthz') as any, res as any)).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});

describe('Built-in check factories', () => {
  it('memoryUsageCheck returns pass under normal conditions', async () => {
    const check = memoryUsageCheck();
    const result = await check();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('Heap usage');
  });

  it('memoryUsageCheck returns fail when threshold is tiny', async () => {
    // Set threshold to 1MB — any real process will exceed this
    const check = memoryUsageCheck(1);
    const result = await check();
    expect(result.status).toBe('fail');
  });

  it('eventLoopCheck returns pass under normal conditions', async () => {
    const check = eventLoopCheck();
    const result = await check();
    expect(result.status).toBe('pass');
    expect(result.message).toContain('Event loop delay');
  });
});
