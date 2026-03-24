/**
 * http-transport.test.ts — Integration tests for HTTP MCP transport.
 * These tests use the real StreamableHTTPServerTransport (no mocks).
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';

/** Helper to make HTTP requests using the Node.js http module. */
function httpRequest(
  options: http.RequestOptions,
  body?: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () =>
        resolve({ status: res.statusCode!, body: data, headers: res.headers }),
      );
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('HTTP MCP Transport', () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
    // Always clean up env var
    delete process.env.AGENT_SENTRY_ACCESS_KEY;
  });

  it('health endpoint returns ok', async () => {
    const { createHttpTransport } = await import('../../src/mcp/transport');
    const transport = createHttpTransport(0);
    await transport.ready;
    cleanup = () => transport.close();

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: transport.port,
      path: '/health',
      method: 'GET',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', transport: 'http' });
  });

  it('CORS preflight returns 204', async () => {
    const { createHttpTransport } = await import('../../src/mcp/transport');
    const transport = createHttpTransport(0);
    await transport.ready;
    cleanup = () => transport.close();

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: transport.port,
      path: '/mcp',
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
  });

  it('rejects invalid access key with 401', async () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'test-secret-key';
    const { createHttpTransport } = await import('../../src/mcp/transport');
    const transport = createHttpTransport(0, 'test-secret-key');
    await transport.ready;
    cleanup = () => transport.close();

    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port: transport.port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-sentry-key': 'wrong-key',
        },
      },
      '{}',
    );
    expect(res.status).toBe(401);
  });

  it('accepts valid access key', async () => {
    process.env.AGENT_SENTRY_ACCESS_KEY = 'test-secret-key';
    const { createHttpTransport } = await import('../../src/mcp/transport');
    const transport = createHttpTransport(0, 'test-secret-key');
    await transport.ready;
    cleanup = () => transport.close();

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: transport.port,
      path: '/health',
      method: 'GET',
      headers: { 'x-agent-sentry-key': 'test-secret-key' },
    });
    expect(res.status).toBe(200);
  });

  it('CORS headers are present on responses', async () => {
    const { createHttpTransport } = await import('../../src/mcp/transport');
    const transport = createHttpTransport(0);
    await transport.ready;
    cleanup = () => transport.close();

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: transport.port,
      path: '/health',
      method: 'GET',
    });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });

  it('transport property is a StreamableHTTPServerTransport', async () => {
    const { createHttpTransport } = await import('../../src/mcp/transport');
    const transport = createHttpTransport(0);
    await transport.ready;
    cleanup = () => transport.close();

    expect(transport.transport).toBeDefined();
    expect(typeof transport.transport.handleRequest).toBe('function');
    expect(typeof transport.transport.close).toBe('function');
  });

  it('port is set correctly when using port 0', async () => {
    const { createHttpTransport } = await import('../../src/mcp/transport');
    const transport = createHttpTransport(0);
    await transport.ready;
    cleanup = () => transport.close();

    expect(transport.port).toBeGreaterThan(0);
  });
});
