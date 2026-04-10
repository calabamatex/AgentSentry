import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { DashboardServer } from '../../src/dashboard/server';

const TEST_TOKEN = 'server-test-token';

/** Simple HTTP GET helper. */
function httpGet(url: string, extraHeaders?: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: extraHeaders }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    }).on('error', reject);
  });
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

describe('DashboardServer', () => {
  let server: DashboardServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts and stops without error', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();
    expect(info.port).toBeGreaterThan(0);
    expect(server.isRunning()).toBe(true);

    await server.stop();
    expect(server.isRunning()).toBe(false);
    server = null;
  });

  it('serves dashboard HTML at /', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('AgentSentry Dashboard v5');
    expect(res.body).toContain('EventSource');
  });

  it('serves dashboard HTML at /index.html', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/index.html`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toContain('AgentSentry Dashboard v5');
  });

  it('returns 404 for unknown paths', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/nonexistent`, authHeaders());
    expect(res.status).toBe(404);
  });

  it('serves /api/health with health check results', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/health`, authHeaders());
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.status).toMatch(/healthy|degraded|unhealthy/);
    expect(data.checks).toBeDefined();
  });

  it('serves /api/metrics with Prometheus text', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/metrics`, authHeaders());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('serves /api/plugins with JSON array', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/plugins`, authHeaders());
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
  });

  it('serves /api/stats with uptime and client count', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/stats`, authHeaders());
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(typeof data.uptime).toBe('number');
    expect(typeof data.clients).toBe('number');
  });

  it('establishes SSE connection at /events', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    // Connect as SSE client — read initial comment
    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${info.port}/events`, { headers: authHeaders() }, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');

        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
          // Got the initial comment — done
          if (data.includes(': connected')) {
            res.destroy();
            resolve(data);
          }
        });
        res.on('error', () => resolve(data)); // destroyed connection
      }).on('error', reject);
    });

    expect(body).toContain(': connected');
  });

  it('sets CORS headers', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/stats`, authHeaders());
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:9200');
  });

  it('throws if started twice', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    await server.start();
    await expect(server.start()).rejects.toThrow('already running');
  });

  it('returns correct URL in server info', async () => {
    server = new DashboardServer({ port: 0, host: '127.0.0.1', token: TEST_TOKEN });
    const info = await server.start();
    expect(info.url).toBe(`http://127.0.0.1:${info.port}`);
  });

  it('returns memory stats when memoryStore is provided', async () => {
    // Create a minimal mock MemoryStore with stats()
    const mockMemoryStore = {
      stats: async () => ({
        total_events: 42,
        by_type: {},
        by_severity: {},
        by_skill: {},
      }),
      initialize: async () => {},
      close: async () => {},
    } as any;

    server = new DashboardServer({ port: 0, token: TEST_TOKEN, memoryStore: mockMemoryStore });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/stats`, authHeaders());
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(typeof data.uptime).toBe('number');
    expect(data.memory).toBeDefined();
    expect(data.memory.total_events).toBe(42);
  });

  it('returns stream-only stats when memoryStore is absent', async () => {
    server = new DashboardServer({ port: 0, token: TEST_TOKEN });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/stats`, authHeaders());
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(typeof data.uptime).toBe('number');
    expect(data.memory).toBeUndefined();
  });
});
