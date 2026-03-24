/**
 * sse-transport.ts — Server-Sent Events transport (M4 Task 4.5)
 *
 * Exposes an HTTP server that streams events to clients using the SSE
 * protocol. Supports filter query params, Last-Event-ID replay, and a
 * /health endpoint.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { EventStream, StreamClient, StreamEvent, StreamFilter } from './event-stream';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SseTransportOptions {
  /** Port to listen on (default 9100). */
  port?: number;
  /** Host to bind to (default '127.0.0.1'). */
  host?: string;
  /** URL path for SSE stream (default '/events'). */
  path?: string;
  /** CORS origin header (default '*'). */
  corsOrigin?: string;
}

// ---------------------------------------------------------------------------
// SseTransport
// ---------------------------------------------------------------------------

export class SseTransport {
  private server: http.Server | null = null;
  private stream: EventStream;
  private options: Required<SseTransportOptions>;
  private startTime: number = 0;

  constructor(stream: EventStream, options?: SseTransportOptions) {
    this.stream = stream;
    this.options = {
      port: options?.port ?? 9100,
      host: options?.host ?? '127.0.0.1',
      path: options?.path ?? '/events',
      corsOrigin: options?.corsOrigin ?? '*',
    };
  }

  /** Start the HTTP server. Resolves with the bound address. */
  async start(): Promise<{ port: number; host: string }> {
    if (this.server) {
      throw new Error('SseTransport is already running');
    }

    this.startTime = Date.now();

    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handleRequest(req, res));

      srv.on('error', (err) => {
        reject(err);
      });

      srv.listen(this.options.port, this.options.host, () => {
        this.server = srv;
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          resolve({ port: addr.port, host: addr.address });
        } else {
          resolve({ port: this.options.port, host: this.options.host });
        }
      });
    });
  }

  /** Stop the HTTP server. */
  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
      // Force-close any lingering connections.
      this.server!.closeAllConnections?.();
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  // -------------------------------------------------------------------------
  // Request handling
  // -------------------------------------------------------------------------

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', this.options.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Last-Event-ID, Cache-Control');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/health') {
      this.handleHealthCheck(req, res);
      return;
    }

    if (url.pathname === this.options.path) {
      this.handleSseConnection(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  private handleHealthCheck(_req: http.IncomingMessage, res: http.ServerResponse): void {
    const stats = this.stream.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      clients: stats.clientCount,
      uptime: Date.now() - this.startTime,
      eventsPublished: stats.eventsPublished,
    }));
  }

  private handleSseConnection(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const filter = this.parseFilter(url);
    const clientId = crypto.randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Client-Id': clientId,
    });

    // Initial comment to flush headers
    res.write(': connected\n\n');

    const client: StreamClient = {
      id: clientId,
      connectedAt: new Date().toISOString(),
      filter,
      transport: 'sse',
      send(event: StreamEvent): void {
        if (event.type === 'heartbeat') {
          res.write(': heartbeat\n\n');
          return;
        }
        let msg = '';
        if (event.id) msg += `id: ${event.id}\n`;
        msg += `event: ${event.type}\n`;
        msg += `data: ${JSON.stringify(event.data)}\n\n`;
        res.write(msg);
      },
      close(): void {
        res.end();
      },
    };

    if (!this.stream.addClient(client)) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Max clients reached' }));
      return;
    }

    // Replay from Last-Event-ID if provided
    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId) {
      // Find the timestamp of the event with the given id and replay from there
      const buf = this.stream.getBuffer();
      const idx = buf.findIndex((e) => e.id === lastEventId);
      if (idx >= 0 && idx < buf.length - 1) {
        const since = buf[idx].timestamp;
        this.stream.replay(clientId, since);
      }
    }

    // Clean up on disconnect
    req.on('close', () => {
      this.stream.removeClient(clientId);
    });
  }

  /** Parse filter parameters from query string. */
  private parseFilter(url: URL): StreamFilter {
    const filter: StreamFilter = {};

    const types = url.searchParams.get('types');
    if (types) filter.eventTypes = types.split(',').map((s) => s.trim());

    const severities = url.searchParams.get('severity');
    if (severities) filter.severities = severities.split(',').map((s) => s.trim());

    const skills = url.searchParams.get('skills');
    if (skills) filter.skills = skills.split(',').map((s) => s.trim());

    const sessionId = url.searchParams.get('session_id');
    if (sessionId) filter.sessionId = sessionId;

    const agentId = url.searchParams.get('agent_id');
    if (agentId) filter.agentId = agentId;

    const tags = url.searchParams.get('tags');
    if (tags) filter.tags = tags.split(',').map((s) => s.trim());

    return filter;
  }
}
