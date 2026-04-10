/**
 * PooledSupabaseProvider unit tests — validates connection pooling behavior.
 *
 * Uses HTTP mocking (same pattern as supabase-provider.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { PooledSupabaseProvider } from '../../../src/memory/providers/pooled-supabase-provider';

let mockServer: http.Server;
let serverPort: number;
let lastRequest: { method: string; path: string; body: string; headers: Record<string, string | string[] | undefined> };

function startMockServer(handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        lastRequest = { method: req.method ?? 'GET', path: req.url ?? '/', body, headers: req.headers };
        if (handler) {
          handler(req, res);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      });
    });
    mockServer.listen(0, '127.0.0.1', () => {
      const addr = mockServer.address();
      serverPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (mockServer) {
      mockServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

function createProvider(): PooledSupabaseProvider {
  return new PooledSupabaseProvider({
    url: `http://127.0.0.1:${serverPort}`,
    serviceRoleKey: 'test-key',
    poolOptions: { maxConnections: 5, keepAlive: true },
  });
}

describe('PooledSupabaseProvider', () => {
  beforeEach(async () => {
    await startMockServer();
  });

  afterEach(async () => {
    await stopMockServer();
  });

  describe('initialize', () => {
    it('calls ensure_ops_schema RPC', async () => {
      await startMockServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('null');
      });

      const provider = createProvider();
      await provider.initialize();
      expect(lastRequest.path).toContain('/rest/v1/rpc/ensure_ops_schema');
      await provider.close();
    });

    it('throws if URL is missing', async () => {
      const provider = new PooledSupabaseProvider({ url: '', serviceRoleKey: 'key' });
      await expect(provider.initialize()).rejects.toThrow('requires SUPABASE_URL');
    });
  });

  describe('insert', () => {
    it('sends POST to /rest/v1/ops_events', async () => {
      await stopMockServer();
      await startMockServer((_req, res) => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end('null');
      });

      const provider = createProvider();
      await provider.insert({
        id: 'test-1',
        timestamp: '2026-01-01T00:00:00Z',
        session_id: 's1',
        agent_id: 'a1',
        event_type: 'decision',
        severity: 'low',
        skill: 'system',
        title: 'Test',
        detail: 'Detail',
        affected_files: [],
        tags: [],
        metadata: {},
        hash: 'h1',
        prev_hash: 'h0',
      });

      expect(lastRequest.method).toBe('POST');
      expect(lastRequest.path).toBe('/rest/v1/ops_events');
      const body = JSON.parse(lastRequest.body);
      expect(body.id).toBe('test-1');
      await provider.close();
    });
  });

  describe('getById', () => {
    it('sends GET with id filter', async () => {
      await stopMockServer();
      await startMockServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{
          id: 'test-1', timestamp: '2026-01-01T00:00:00Z', session_id: 's1',
          agent_id: 'a1', event_type: 'decision', severity: 'low', skill: 'system',
          title: 'Test', detail: 'Detail', affected_files: '[]', tags: '[]',
          metadata: '{}', hash: 'h1', prev_hash: 'h0',
        }]));
      });

      const provider = createProvider();
      const event = await provider.getById('test-1');
      expect(event).not.toBeNull();
      expect(event!.id).toBe('test-1');
      expect(lastRequest.path).toContain('id=eq.test-1');
      await provider.close();
    });

    it('returns null when not found', async () => {
      const provider = createProvider();
      const event = await provider.getById('nonexistent');
      expect(event).toBeNull();
      await provider.close();
    });
  });

  describe('textSearch (inherited from base)', () => {
    it('sends ilike query on title and detail', async () => {
      const provider = createProvider();
      await provider.textSearch('error', { limit: 5 });
      expect(lastRequest.path).toContain('ilike');
      expect(lastRequest.path).toContain('error');
      expect(lastRequest.path).toContain('limit=5');
      await provider.close();
    });
  });

  describe('getLatestHash (inherited from base)', () => {
    it('returns hash from most recent event', async () => {
      await stopMockServer();
      await startMockServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ hash: 'abc123' }]));
      });

      const provider = createProvider();
      const hash = await provider.getLatestHash();
      expect(hash).toBe('abc123');
      expect(lastRequest.path).toContain('select=hash');
      expect(lastRequest.path).toContain('order=timestamp.desc');
      expect(lastRequest.path).toContain('limit=1');
      await provider.close();
    });

    it('returns null when no events exist', async () => {
      const provider = createProvider();
      const hash = await provider.getLatestHash();
      expect(hash).toBeNull();
      await provider.close();
    });
  });

  describe('pool stats', () => {
    it('tracks request count and duration', async () => {
      const provider = createProvider();
      await provider.getById('x');
      await provider.getById('y');

      const stats = provider.getPool().stats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.avgResponseTime).toBeGreaterThan(0);
      await provider.close();
    });
  });

  describe('close', () => {
    it('destroys the connection pool', async () => {
      const provider = createProvider();
      await provider.close();
      const stats = provider.getPool().stats();
      expect(stats.totalConnections).toBe(0);
    });
  });
});
