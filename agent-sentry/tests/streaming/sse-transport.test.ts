import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { EventStream, StreamEvent } from '../../src/streaming/event-stream';
import { SseTransport } from '../../src/streaming/sse-transport';

/** Helper to make a GET request and return the full response. */
function httpGet(url: string, headers?: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
      });
    });
    req.on('error', reject);
  });
}

/** Helper to open an SSE connection and collect a certain number of events. */
function collectSseEvents(
  url: string,
  count: number,
  timeoutMs: number = 3000,
  headers?: Record<string, string>,
): Promise<{ events: Array<{ id?: string; event?: string; data?: string }>; response: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const events: Array<{ id?: string; event?: string; data?: string }> = [];
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ events, response: null as unknown as http.IncomingMessage });
    }, timeoutMs);

    const req = http.get(url, { headers }, (res) => {
      let partial = '';

      res.on('data', (chunk: Buffer) => {
        partial += chunk.toString();

        // Parse SSE messages separated by double newlines
        const parts = partial.split('\n\n');
        partial = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.trim() || part.startsWith(':')) continue;

          const entry: { id?: string; event?: string; data?: string } = {};
          for (const line of part.split('\n')) {
            if (line.startsWith('id: ')) entry.id = line.slice(4);
            else if (line.startsWith('event: ')) entry.event = line.slice(7);
            else if (line.startsWith('data: ')) entry.data = line.slice(6);
          }
          if (entry.event || entry.data) {
            events.push(entry);
          }

          if (events.length >= count) {
            clearTimeout(timer);
            req.destroy();
            resolve({ events, response: res });
            return;
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timer);
        resolve({ events, response: res });
      });
    });

    req.on('error', (err) => {
      // ECONNRESET is expected when we destroy the request early
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
        clearTimeout(timer);
        resolve({ events, response: null as unknown as http.IncomingMessage });
      } else {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

describe('SseTransport', () => {
  let stream: EventStream;
  let transport: SseTransport;
  let port: number;

  beforeEach(async () => {
    stream = new EventStream({ maxClients: 10, bufferSize: 50 });
    // Use port 0 for a random available port
    transport = new SseTransport(stream, { port: 0, host: '127.0.0.1' });
    const addr = await transport.start();
    port = addr.port;
  });

  afterEach(async () => {
    stream.stop();
    await transport.stop();
  });

  // -----------------------------------------------------------------------
  // Server lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('should start and report running', () => {
      expect(transport.isRunning()).toBe(true);
    });

    it('should stop and report not running', async () => {
      await transport.stop();
      expect(transport.isRunning()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Health endpoint
  // -----------------------------------------------------------------------

  describe('health endpoint', () => {
    it('should return JSON health status', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      const body = JSON.parse(res.body);
      expect(body.status).toBe('ok');
      expect(typeof body.clients).toBe('number');
      expect(typeof body.uptime).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // CORS
  // -----------------------------------------------------------------------

  describe('CORS headers', () => {
    it('should include Access-Control-Allow-Origin', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  // -----------------------------------------------------------------------
  // 404
  // -----------------------------------------------------------------------

  describe('unknown path', () => {
    it('should return 404 for unknown paths', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // SSE streaming
  // -----------------------------------------------------------------------

  describe('SSE connection', () => {
    it('should receive published events via SSE', async () => {
      // Start collecting 2 events
      const collecting = collectSseEvents(`http://127.0.0.1:${port}/events`, 2, 3000);

      // Wait briefly for the connection to establish
      await new Promise((r) => setTimeout(r, 100));

      // Publish events
      stream.publish({ id: 'e1', type: 'decision', timestamp: new Date().toISOString(), data: { title: 'first' } });
      stream.publish({ id: 'e2', type: 'incident', timestamp: new Date().toISOString(), data: { title: 'second' } });

      const result = await collecting;
      expect(result.events).toHaveLength(2);
      expect(result.events[0].event).toBe('decision');
      expect(result.events[1].event).toBe('incident');
    });

    it('should filter events via query params', async () => {
      const collecting = collectSseEvents(
        `http://127.0.0.1:${port}/events?types=incident`,
        1,
        3000,
      );

      await new Promise((r) => setTimeout(r, 100));

      // This one should be filtered out
      stream.publish({ id: 'e1', type: 'decision', timestamp: new Date().toISOString(), data: {} });
      // This one should pass
      stream.publish({ id: 'e2', type: 'incident', timestamp: new Date().toISOString(), data: {} });

      const result = await collecting;
      expect(result.events).toHaveLength(1);
      expect(result.events[0].event).toBe('incident');
    });
  });

  // -----------------------------------------------------------------------
  // Client cleanup
  // -----------------------------------------------------------------------

  describe('client cleanup', () => {
    it('should remove client on disconnect', async () => {
      // Connect and then immediately disconnect
      const req = http.get(`http://127.0.0.1:${port}/events`);

      await new Promise((r) => setTimeout(r, 100));
      expect(stream.getClientCount()).toBe(1);

      req.destroy();
      await new Promise((r) => setTimeout(r, 100));
      expect(stream.getClientCount()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Last-Event-ID replay
  // -----------------------------------------------------------------------

  describe('Last-Event-ID replay', () => {
    it('should replay events after the given Last-Event-ID', async () => {
      // Pre-populate buffer
      stream.publish({ id: 'e1', type: 'decision', timestamp: '2025-01-01T00:00:01.000Z', data: { n: 1 } });
      stream.publish({ id: 'e2', type: 'incident', timestamp: '2025-01-01T00:00:02.000Z', data: { n: 2 } });
      stream.publish({ id: 'e3', type: 'decision', timestamp: '2025-01-01T00:00:03.000Z', data: { n: 3 } });

      // Connect with Last-Event-ID = e1 (should replay e2, e3)
      const collecting = collectSseEvents(
        `http://127.0.0.1:${port}/events`,
        2,
        3000,
        { 'Last-Event-ID': 'e1' },
      );

      const result = await collecting;
      expect(result.events.length).toBeGreaterThanOrEqual(2);
    });
  });
});
