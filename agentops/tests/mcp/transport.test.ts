/**
 * transport.test.ts — Tests for MCP transport layer.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: vi.fn().mockImplementation(() => ({
      type: 'stdio',
    })),
  };
});

import { createStdioTransport, createHttpTransport } from '../../src/mcp/transport';

describe('Transport', () => {
  describe('createStdioTransport', () => {
    it('should create a StdioServerTransport instance', () => {
      const transport = createStdioTransport();
      expect(transport).toBeDefined();
      expect((transport as unknown as { type: string }).type).toBe('stdio');
    });
  });

  describe('createHttpTransport', () => {
    let httpTransport: ReturnType<typeof createHttpTransport> | null = null;

    afterEach(async () => {
      if (httpTransport) {
        await httpTransport.close();
        httpTransport = null;
      }
    });

    it('should create an HTTP server on specified port', async () => {
      httpTransport = createHttpTransport(0); // port 0 = random available port
      const addr = httpTransport.server.address();
      expect(addr).not.toBeNull();
    });

    it('should respond to health check', async () => {
      httpTransport = createHttpTransport(0);
      const addr = httpTransport.server.address();
      if (!addr || typeof addr === 'string') return;

      const response = await fetch(`http://127.0.0.1:${addr.port}/health`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    it('should reject requests without valid access key', async () => {
      const originalKey = process.env.AGENTOPS_ACCESS_KEY;
      process.env.AGENTOPS_ACCESS_KEY = 'test-secret-key';

      try {
        httpTransport = createHttpTransport(0, 'test-secret-key');
        const addr = httpTransport.server.address();
        if (!addr || typeof addr === 'string') return;

        const response = await fetch(`http://127.0.0.1:${addr.port}/health`);
        expect(response.status).toBe(401);
      } finally {
        if (originalKey === undefined) {
          delete process.env.AGENTOPS_ACCESS_KEY;
        } else {
          process.env.AGENTOPS_ACCESS_KEY = originalKey;
        }
      }
    });

    it('should accept requests with valid access key in header', async () => {
      const originalKey = process.env.AGENTOPS_ACCESS_KEY;
      process.env.AGENTOPS_ACCESS_KEY = 'test-secret-key';

      try {
        httpTransport = createHttpTransport(0, 'test-secret-key');
        const addr = httpTransport.server.address();
        if (!addr || typeof addr === 'string') return;

        const response = await fetch(`http://127.0.0.1:${addr.port}/health`, {
          headers: { 'x-agentops-key': 'test-secret-key' },
        });
        expect(response.status).toBe(200);
      } finally {
        if (originalKey === undefined) {
          delete process.env.AGENTOPS_ACCESS_KEY;
        } else {
          process.env.AGENTOPS_ACCESS_KEY = originalKey;
        }
      }
    });

    it('should accept requests with valid access key in query param', async () => {
      const originalKey = process.env.AGENTOPS_ACCESS_KEY;
      process.env.AGENTOPS_ACCESS_KEY = 'test-secret-key';

      try {
        httpTransport = createHttpTransport(0, 'test-secret-key');
        const addr = httpTransport.server.address();
        if (!addr || typeof addr === 'string') return;

        const response = await fetch(`http://127.0.0.1:${addr.port}/health?key=test-secret-key`);
        expect(response.status).toBe(200);
      } finally {
        if (originalKey === undefined) {
          delete process.env.AGENTOPS_ACCESS_KEY;
        } else {
          process.env.AGENTOPS_ACCESS_KEY = originalKey;
        }
      }
    });

    it('should reject invalid POST JSON', async () => {
      httpTransport = createHttpTransport(0);
      const addr = httpTransport.server.address();
      if (!addr || typeof addr === 'string') return;

      const response = await fetch(`http://127.0.0.1:${addr.port}/`, {
        method: 'POST',
        body: 'not json',
      });
      expect(response.status).toBe(400);
    });

    it('should accept valid POST JSON', async () => {
      httpTransport = createHttpTransport(0);
      const addr = httpTransport.server.address();
      if (!addr || typeof addr === 'string') return;

      const response = await fetch(`http://127.0.0.1:${addr.port}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' }),
      });
      expect(response.status).toBe(200);
    });

    it('should reject unsupported methods', async () => {
      httpTransport = createHttpTransport(0);
      const addr = httpTransport.server.address();
      if (!addr || typeof addr === 'string') return;

      const response = await fetch(`http://127.0.0.1:${addr.port}/`, {
        method: 'DELETE',
      });
      expect(response.status).toBe(405);
    });

    it('should close cleanly', async () => {
      httpTransport = createHttpTransport(0);
      await httpTransport.close();
      httpTransport = null;
    });
  });
});
