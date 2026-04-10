/**
 * dashboard-startup.test.ts — E2E: Start dashboard server, verify HTTP
 * endpoints respond correctly, then shut down cleanly.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as http from 'http';
import { DashboardServer } from '../../src/dashboard/server';

const TEST_PORT = 19_200 + Math.floor(Math.random() * 1000);
const TEST_TOKEN = 'e2e-dashboard-test-token';

/** Simple HTTP GET helper. */
function httpGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${TEST_PORT}${path}`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

let server: DashboardServer | null = null;

describe('Dashboard Startup (e2e)', () => {
  afterAll(async () => {
    if (server) {
      await server.stop();
    }
  });

  it('DashboardServer class can be instantiated', () => {
    server = new DashboardServer({ port: TEST_PORT, host: '127.0.0.1', token: TEST_TOKEN });
    expect(server).toBeDefined();
  });

  it('server starts and listens', async () => {
    if (!server) return;
    await server.start();
    // If start() resolves without error, the server is listening
  });

  it('GET / returns 200 with HTML', async () => {
    const { status, body } = await httpGet('/');
    expect(status).toBe(200);
    expect(body).toContain('<html');
  });

  it('GET /api/health returns 200 with JSON', async () => {
    const { status, body } = await httpGet('/api/health');
    expect(status).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed).toBeDefined();
  });

  it('GET /api/stats returns 200 with JSON', async () => {
    const { status, body } = await httpGet('/api/stats');
    expect(status).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed).toBeDefined();
  });

  it('server shuts down cleanly', async () => {
    if (!server) return;
    await server.stop();
    server = null;
    // After stop, requests should fail
    await expect(httpGet('/')).rejects.toThrow();
  });
});
