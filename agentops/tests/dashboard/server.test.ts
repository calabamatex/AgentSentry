import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { DashboardServer } from '../../src/dashboard/server';

/** Simple HTTP GET helper. */
function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    }).on('error', reject);
  });
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
    server = new DashboardServer({ port: 0 });
    const info = await server.start();
    expect(info.port).toBeGreaterThan(0);
    expect(server.isRunning()).toBe(true);

    await server.stop();
    expect(server.isRunning()).toBe(false);
    server = null;
  });

  it('serves dashboard HTML at /', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('AgentOps Dashboard v5');
    expect(res.body).toContain('EventSource');
  });

  it('serves dashboard HTML at /index.html', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/index.html`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('AgentOps Dashboard v5');
  });

  it('returns 404 for unknown paths', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('serves /api/health with health check results', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/health`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.status).toMatch(/healthy|degraded|unhealthy/);
    expect(data.checks).toBeDefined();
  });

  it('serves /api/metrics with Prometheus text', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('serves /api/plugins with JSON array', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/plugins`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
  });

  it('serves /api/stats with uptime and client count', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/stats`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(typeof data.uptime).toBe('number');
    expect(typeof data.clients).toBe('number');
  });

  it('establishes SSE connection at /events', async () => {
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    // Connect as SSE client — read initial comment
    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${info.port}/events`, (res) => {
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
    server = new DashboardServer({ port: 0 });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/api/stats`);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('throws if started twice', async () => {
    server = new DashboardServer({ port: 0 });
    await server.start();
    await expect(server.start()).rejects.toThrow('already running');
  });

  it('returns correct URL in server info', async () => {
    server = new DashboardServer({ port: 0, host: '127.0.0.1' });
    const info = await server.start();
    expect(info.url).toBe(`http://127.0.0.1:${info.port}`);
  });
});
