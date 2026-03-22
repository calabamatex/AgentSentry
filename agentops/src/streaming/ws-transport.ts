/**
 * ws-transport.ts — WebSocket transport (M4 Task 4.5)
 *
 * Raw RFC 6455 WebSocket implementation using only Node built-in modules.
 * No external dependencies. Handles handshake, text frames, ping/pong,
 * and close frames.
 */

import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { EventStream, StreamClient, StreamEvent, StreamFilter } from './event-stream';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'ws-transport' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RFC 6455 Section 4.2.2 — magic GUID for Sec-WebSocket-Accept. */
export const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-5AB5FC11B36';

// WebSocket opcodes
const OPCODE_TEXT = 0x01;
const OPCODE_CLOSE = 0x08;
const OPCODE_PING = 0x09;
const OPCODE_PONG = 0x0A;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsTransportOptions {
  /** Port to listen on (default 9101). */
  port?: number;
  /** Host to bind to (default '127.0.0.1'). */
  host?: string;
  /** URL path for WebSocket upgrades (default '/ws'). */
  path?: string;
}

// ---------------------------------------------------------------------------
// WsTransport
// ---------------------------------------------------------------------------

export class WsTransport {
  private server: http.Server | null = null;
  private stream: EventStream;
  private options: Required<WsTransportOptions>;
  private sockets: Set<net.Socket> = new Set();

  constructor(stream: EventStream, options?: WsTransportOptions) {
    this.stream = stream;
    this.options = {
      port: options?.port ?? 9101,
      host: options?.host ?? '127.0.0.1',
      path: options?.path ?? '/ws',
    };
  }

  /** Start the HTTP server with WebSocket upgrade support. */
  async start(): Promise<{ port: number; host: string }> {
    if (this.server) {
      throw new Error('WsTransport is already running');
    }

    return new Promise((resolve, reject) => {
      const srv = http.createServer((_req, res) => {
        res.writeHead(426, { 'Content-Type': 'text/plain' });
        res.end('Upgrade Required');
      });

      srv.on('upgrade', (req, socket, head) => {
        this.handleUpgrade(req, socket as net.Socket, head);
      });

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

  /** Stop the server and disconnect all WebSocket clients. */
  async stop(): Promise<void> {
    if (!this.server) return;

    // Destroy all tracked WebSocket sockets so the server can close promptly.
    for (const socket of this.sockets) {
      try { socket.destroy(); } catch (e) { logger.debug('Socket destroy failed during stop', { error: e instanceof Error ? e.message : String(e) }); }
    }
    this.sockets.clear();

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
      // Also close any HTTP-level connections.
      this.server!.closeAllConnections?.();
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  // -------------------------------------------------------------------------
  // WebSocket handshake (RFC 6455 Section 4.2)
  // -------------------------------------------------------------------------

  private handleUpgrade(req: http.IncomingMessage, socket: net.Socket, _head: Buffer): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Track all upgrade sockets for forced cleanup on stop().
    this.sockets.add(socket);
    socket.on('close', () => { this.sockets.delete(socket); });

    if (url.pathname !== this.options.path) {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Compute Sec-WebSocket-Accept (RFC 6455 Section 4.2.2)
    const accept = crypto
      .createHash('sha1')
      .update(key + WS_MAGIC_GUID)
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n');

    socket.write(headers);

    const filter = this.parseFilter(url);
    this.createWebSocketClient(socket, filter);
  }

  // -------------------------------------------------------------------------
  // Client management
  // -------------------------------------------------------------------------

  private createWebSocketClient(socket: net.Socket, filter: StreamFilter): StreamClient {
    const clientId = crypto.randomUUID();
    let closed = false;

    const client: StreamClient = {
      id: clientId,
      connectedAt: new Date().toISOString(),
      filter,
      transport: 'websocket',
      send: (event: StreamEvent): void => {
        if (closed) return;
        const payload = JSON.stringify(event);
        const frame = this.encodeFrame(payload);
        try {
          socket.write(frame);
        } catch {
          // Socket write failure.
        }
      },
      close: (): void => {
        if (closed) return;
        closed = true;
        try {
          // Send close frame
          const closeFrame = Buffer.alloc(2);
          closeFrame[0] = 0x80 | OPCODE_CLOSE;
          closeFrame[1] = 0;
          socket.write(closeFrame);
          socket.end();
        } catch {
          // Best-effort close.
        }
      },
    };

    if (!this.stream.addClient(client)) {
      const closeFrame = Buffer.alloc(2);
      closeFrame[0] = 0x80 | OPCODE_CLOSE;
      closeFrame[1] = 0;
      socket.write(closeFrame);
      socket.destroy();
      return client;
    }

    // Buffer for incomplete frames
    let pendingBuffer = Buffer.alloc(0);

    socket.on('data', (data: Buffer) => {
      pendingBuffer = Buffer.concat([pendingBuffer, data]);

      while (pendingBuffer.length >= 2) {
        const result = this.decodeFrame(pendingBuffer);
        if (!result) break; // Incomplete frame

        pendingBuffer = pendingBuffer.slice(result.bytesConsumed);

        if (result.opcode === OPCODE_CLOSE) {
          closed = true;
          this.stream.removeClient(clientId);
          // Echo close frame
          const closeFrame = Buffer.alloc(2);
          closeFrame[0] = 0x80 | OPCODE_CLOSE;
          closeFrame[1] = 0;
          try { socket.write(closeFrame); } catch { /* ignore */ }
          socket.end();
          return;
        }

        if (result.opcode === OPCODE_PING) {
          // Respond with pong
          const pong = this.encodePongFrame(result.payload);
          try { socket.write(pong); } catch { /* ignore */ }
          continue;
        }

        if (result.opcode === OPCODE_PONG) {
          // Ignore pong responses
          continue;
        }

        // Text frame — could be used for dynamic filter updates in the future
      }
    });

    socket.on('close', () => {
      closed = true;
      this.stream.removeClient(clientId);
    });

    socket.on('error', () => {
      closed = true;
      this.stream.removeClient(clientId);
    });

    return client;
  }

  // -------------------------------------------------------------------------
  // WebSocket framing (RFC 6455 Section 5)
  // -------------------------------------------------------------------------

  /** Encode a string payload into a WebSocket text frame (server -> client, unmasked). */
  encodeFrame(data: string): Buffer {
    const payload = Buffer.from(data, 'utf-8');
    const len = payload.length;

    let header: Buffer;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | OPCODE_TEXT; // FIN + text opcode
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | OPCODE_TEXT;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | OPCODE_TEXT;
      header[1] = 127;
      // Write 64-bit length. Node Buffers only handle 32-bit writes natively,
      // so split into two 32-bit writes.
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }

    return Buffer.concat([header, payload]);
  }

  /** Encode a pong frame with the given payload. */
  private encodePongFrame(payload: string): Buffer {
    const buf = Buffer.from(payload, 'utf-8');
    const header = Buffer.alloc(2);
    header[0] = 0x80 | OPCODE_PONG;
    header[1] = buf.length;
    return Buffer.concat([header, buf]);
  }

  /**
   * Decode a WebSocket frame from a buffer.
   * Clients MUST mask their frames (RFC 6455 Section 5.1).
   * Returns null if the buffer is incomplete.
   */
  decodeFrame(buffer: Buffer): { opcode: number; payload: string; bytesConsumed: number } | null {
    if (buffer.length < 2) return null;

    const firstByte = buffer[0];
    const secondByte = buffer[1];
    const opcode = firstByte & 0x0F;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7F;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < 4) return null;
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) return null;
      // Read lower 32 bits only (safe for practical payload sizes)
      payloadLength = buffer.readUInt32BE(6);
      offset = 10;
    }

    if (masked) {
      if (buffer.length < offset + 4 + payloadLength) return null;
      const maskKey = buffer.slice(offset, offset + 4);
      offset += 4;
      const data = buffer.slice(offset, offset + payloadLength);
      for (let i = 0; i < data.length; i++) {
        data[i] ^= maskKey[i % 4];
      }
      return { opcode, payload: data.toString('utf-8'), bytesConsumed: offset + payloadLength };
    }

    if (buffer.length < offset + payloadLength) return null;
    const data = buffer.slice(offset, offset + payloadLength);
    return { opcode, payload: data.toString('utf-8'), bytesConsumed: offset + payloadLength };
  }

  // -------------------------------------------------------------------------
  // Filter parsing
  // -------------------------------------------------------------------------

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
