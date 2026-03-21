import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import * as crypto from 'crypto';
import { EventStream } from '../../src/streaming/event-stream';
import { WsTransport, WS_MAGIC_GUID } from '../../src/streaming/ws-transport';

/**
 * Perform a raw WebSocket handshake and return the connected socket.
 * Uses http.request with the upgrade event to handle the 101 response.
 * If the server rejects the upgrade (e.g. wrong path), the promise rejects.
 */
function wsConnect(port: number, path: string = '/ws'): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (res, socket) => {
      const expectedAccept = crypto
        .createHash('sha1')
        .update(key + WS_MAGIC_GUID)
        .digest('base64');

      const accept = res.headers['sec-websocket-accept'];
      if (accept !== expectedAccept) {
        socket.destroy();
        reject(new Error(`Invalid Sec-WebSocket-Accept: ${accept}`));
        return;
      }

      resolve(socket as net.Socket);
    });

    // When the server rejects the upgrade (e.g. wrong path), we get a
    // normal HTTP response instead of the upgrade event.
    req.on('response', (res) => {
      res.resume(); // drain the response
      reject(new Error(`Upgrade rejected with status ${res.statusCode}`));
    });

    req.on('error', reject);
    req.end();
  });
}

/** Encode a masked WebSocket text frame (client -> server must be masked). */
function encodeClientFrame(data: string, opcode: number = 0x01): Buffer {
  const payload = Buffer.from(data, 'utf-8');
  const maskKey = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ maskKey[i % 4];
  }

  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payload.length; // mask bit set
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }

  return Buffer.concat([header, maskKey, masked]);
}

/** Read incoming WebSocket frames from a socket, collecting text frame payloads. */
function collectWsMessages(
  socket: net.Socket,
  count: number,
  timeoutMs: number = 3000,
): Promise<string[]> {
  return new Promise((resolve) => {
    const messages: string[] = [];
    let pending = Buffer.alloc(0);

    const timer = setTimeout(() => {
      socket.removeAllListeners('data');
      resolve(messages);
    }, timeoutMs);

    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);

      while (pending.length >= 2) {
        const firstByte = pending[0];
        const secondByte = pending[1];
        const opcode = firstByte & 0x0F;
        let payloadLen = secondByte & 0x7F;
        let offset = 2;

        if (payloadLen === 126) {
          if (pending.length < 4) return;
          payloadLen = pending.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (pending.length < 10) return;
          payloadLen = pending.readUInt32BE(6);
          offset = 10;
        }

        if (pending.length < offset + payloadLen) return;

        const payload = pending.slice(offset, offset + payloadLen).toString('utf-8');
        pending = pending.slice(offset + payloadLen);

        if (opcode === 0x01) { // text frame
          messages.push(payload);
        }

        if (messages.length >= count) {
          clearTimeout(timer);
          socket.removeAllListeners('data');
          resolve(messages);
          return;
        }
      }
    });
  });
}

describe('WsTransport', () => {
  let stream: EventStream;
  let transport: WsTransport;
  let port: number;

  beforeEach(async () => {
    stream = new EventStream({ maxClients: 10, bufferSize: 50 });
    transport = new WsTransport(stream, { port: 0, host: '127.0.0.1' });
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
  // WebSocket handshake
  // -----------------------------------------------------------------------

  describe('handshake', () => {
    it('should complete WebSocket handshake with valid accept header', async () => {
      const socket = await wsConnect(port);
      expect(socket).toBeDefined();
      expect(socket.readable).toBe(true);
      socket.destroy();
    });

    it('should reject connections to wrong path', async () => {
      await expect(wsConnect(port, '/wrong')).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Frame encoding/decoding
  // -----------------------------------------------------------------------

  describe('frame encoding', () => {
    it('should encode small text frames correctly', () => {
      const frame = transport.encodeFrame('hello');
      // FIN + text opcode
      expect(frame[0]).toBe(0x81);
      // Payload length = 5, no mask
      expect(frame[1]).toBe(5);
      expect(frame.slice(2).toString('utf-8')).toBe('hello');
    });

    it('should encode medium text frames (126-65535 bytes)', () => {
      const data = 'x'.repeat(200);
      const frame = transport.encodeFrame(data);
      expect(frame[0]).toBe(0x81);
      expect(frame[1]).toBe(126);
      expect(frame.readUInt16BE(2)).toBe(200);
    });
  });

  describe('frame decoding', () => {
    it('should decode masked client frames', () => {
      const clientFrame = encodeClientFrame('test message');
      const result = transport.decodeFrame(clientFrame);
      expect(result).not.toBeNull();
      expect(result!.opcode).toBe(0x01);
      expect(result!.payload).toBe('test message');
    });

    it('should return null for incomplete frames', () => {
      const result = transport.decodeFrame(Buffer.from([0x81]));
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Event delivery
  // -----------------------------------------------------------------------

  describe('event delivery', () => {
    it('should receive events via WebSocket', async () => {
      const socket = await wsConnect(port);
      const collecting = collectWsMessages(socket, 2, 3000);

      await new Promise((r) => setTimeout(r, 100));

      stream.publish({
        id: 'e1',
        type: 'decision',
        timestamp: new Date().toISOString(),
        data: { title: 'first' },
      });
      stream.publish({
        id: 'e2',
        type: 'incident',
        timestamp: new Date().toISOString(),
        data: { title: 'second' },
      });

      const messages = await collecting;
      expect(messages).toHaveLength(2);

      const parsed0 = JSON.parse(messages[0]);
      expect(parsed0.type).toBe('decision');
      const parsed1 = JSON.parse(messages[1]);
      expect(parsed1.type).toBe('incident');

      socket.destroy();
    });

    it('should filter events via query params', async () => {
      const socket = await wsConnect(port, '/ws?types=incident');
      const collecting = collectWsMessages(socket, 1, 3000);

      await new Promise((r) => setTimeout(r, 100));

      // Should be filtered out
      stream.publish({ id: 'e1', type: 'decision', timestamp: new Date().toISOString(), data: {} });
      // Should pass
      stream.publish({ id: 'e2', type: 'incident', timestamp: new Date().toISOString(), data: {} });

      const messages = await collecting;
      expect(messages).toHaveLength(1);
      expect(JSON.parse(messages[0]).type).toBe('incident');

      socket.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Client cleanup
  // -----------------------------------------------------------------------

  describe('client cleanup', () => {
    it('should clean up when client sends close frame', async () => {
      const socket = await wsConnect(port);
      await new Promise((r) => setTimeout(r, 100));
      expect(stream.getClientCount()).toBe(1);

      // Use a proper close frame instead of raw destroy, which
      // reliably triggers server-side cleanup.
      const closeFrame = encodeClientFrame('', 0x08);
      socket.write(closeFrame);

      await new Promise((r) => setTimeout(r, 300));
      expect(stream.getClientCount()).toBe(0);

      socket.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Ping/pong
  // -----------------------------------------------------------------------

  describe('ping/pong', () => {
    it('should respond to ping with pong', async () => {
      const socket = await wsConnect(port);

      // Send a ping frame
      const pingFrame = encodeClientFrame('', 0x09);
      socket.write(pingFrame);

      // Collect any response — we expect a pong
      const pongPromise = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2000);
        socket.on('data', (data: Buffer) => {
          const opcode = data[0] & 0x0F;
          if (opcode === 0x0A) { // pong
            clearTimeout(timer);
            resolve(true);
          }
        });
      });

      const gotPong = await pongPromise;
      expect(gotPong).toBe(true);

      socket.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Close frame
  // -----------------------------------------------------------------------

  describe('close frame', () => {
    it('should handle close frame from client', async () => {
      const socket = await wsConnect(port);
      await new Promise((r) => setTimeout(r, 100));
      expect(stream.getClientCount()).toBe(1);

      // Send close frame (opcode 0x08)
      const closeFrame = encodeClientFrame('', 0x08);
      socket.write(closeFrame);

      await new Promise((r) => setTimeout(r, 200));
      expect(stream.getClientCount()).toBe(0);

      socket.destroy();
    });
  });
});
