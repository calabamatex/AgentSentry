import { describe, it, expect, afterEach, vi } from 'vitest';
import * as http from 'http';
import { DashboardServer } from '../../src/dashboard/server';

/** HTTP request helper with optional headers. */
function httpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('DashboardServer authentication', () => {
  let server: DashboardServer | null = null;
  const TOKEN = 'test-token-abc123';

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('returns 401 when no token is provided in the request', async () => {
    server = new DashboardServer({ port: 0, token: TOKEN });
    const info = await server.start();

    const res = await httpRequest(`http://127.0.0.1:${info.port}/api/stats`);
    expect(res.status).toBe(401);
    const data = JSON.parse(res.body);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 200 when correct Bearer token is provided', async () => {
    server = new DashboardServer({ port: 0, token: TOKEN });
    const info = await server.start();

    const res = await httpRequest(`http://127.0.0.1:${info.port}/api/stats`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 when wrong token is provided', async () => {
    server = new DashboardServer({ port: 0, token: TOKEN });
    const info = await server.start();

    const res = await httpRequest(`http://127.0.0.1:${info.port}/api/stats`, {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('OPTIONS (CORS preflight) returns 204 without auth', async () => {
    server = new DashboardServer({ port: 0, token: TOKEN });
    const info = await server.start();

    const res = await httpRequest(`http://127.0.0.1:${info.port}/api/stats`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
  });

  it('uses token from AGENT_SENTRY_DASHBOARD_TOKEN env var', async () => {
    const envToken = 'env-token-xyz789';
    vi.stubEnv('AGENT_SENTRY_DASHBOARD_TOKEN', envToken);

    try {
      server = new DashboardServer({ port: 0, token: 'should-be-ignored' });
      const info = await server.start();

      // Request with env token should succeed
      const res = await httpRequest(`http://127.0.0.1:${info.port}/api/stats`, {
        headers: { Authorization: `Bearer ${envToken}` },
      });
      expect(res.status).toBe(200);

      // Request with the options token should fail (env takes precedence)
      const res2 = await httpRequest(`http://127.0.0.1:${info.port}/api/stats`, {
        headers: { Authorization: 'Bearer should-be-ignored' },
      });
      expect(res2.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('accepts token as query parameter for SSE compatibility', async () => {
    server = new DashboardServer({ port: 0, token: TOKEN });
    const info = await server.start();

    const res = await httpRequest(`http://127.0.0.1:${info.port}/api/stats?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });
});
