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

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  return {
    StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
      type: 'streamableHttp',
      handleRequest: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
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
      httpTransport = createHttpTransport(0);
      await httpTransport.ready;
      const addr = httpTransport.server.address();
      expect(addr).not.toBeNull();
    });

    it('should expose a transport property', async () => {
      httpTransport = createHttpTransport(0);
      await httpTransport.ready;
      expect(httpTransport.transport).toBeDefined();
      expect((httpTransport.transport as unknown as { type: string }).type).toBe('streamableHttp');
    });

    it('should respond to health check', async () => {
      httpTransport = createHttpTransport(0);
      await httpTransport.ready;
      const addr = httpTransport.server.address();
      if (!addr || typeof addr === 'string') return;

      const response = await fetch(`http://127.0.0.1:${addr.port}/health`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    it('should reject requests without valid access key', async () => {
      const originalKey = process.env.AGENT_SENTRY_ACCESS_KEY;
      process.env.AGENT_SENTRY_ACCESS_KEY = 'test-secret-key';

      try {
        httpTransport = createHttpTransport(0, 'test-secret-key');
        await httpTransport.ready;
        const addr = httpTransport.server.address();
        if (!addr || typeof addr === 'string') return;

        const response = await fetch(`http://127.0.0.1:${addr.port}/health`);
        expect(response.status).toBe(401);
      } finally {
        if (originalKey === undefined) {
          delete process.env.AGENT_SENTRY_ACCESS_KEY;
        } else {
          process.env.AGENT_SENTRY_ACCESS_KEY = originalKey;
        }
      }
    });

    it('should accept requests with valid access key in header', async () => {
      const originalKey = process.env.AGENT_SENTRY_ACCESS_KEY;
      process.env.AGENT_SENTRY_ACCESS_KEY = 'test-secret-key';

      try {
        httpTransport = createHttpTransport(0, 'test-secret-key');
        await httpTransport.ready;
        const addr = httpTransport.server.address();
        if (!addr || typeof addr === 'string') return;

        const response = await fetch(`http://127.0.0.1:${addr.port}/health`, {
          headers: { 'x-agent-sentry-key': 'test-secret-key' },
        });
        expect(response.status).toBe(200);
      } finally {
        if (originalKey === undefined) {
          delete process.env.AGENT_SENTRY_ACCESS_KEY;
        } else {
          process.env.AGENT_SENTRY_ACCESS_KEY = originalKey;
        }
      }
    });

    it('should accept requests with valid access key in query param', async () => {
      const originalKey = process.env.AGENT_SENTRY_ACCESS_KEY;
      process.env.AGENT_SENTRY_ACCESS_KEY = 'test-secret-key';

      try {
        httpTransport = createHttpTransport(0, 'test-secret-key');
        await httpTransport.ready;
        const addr = httpTransport.server.address();
        if (!addr || typeof addr === 'string') return;

        const response = await fetch(`http://127.0.0.1:${addr.port}/health?key=test-secret-key`);
        expect(response.status).toBe(200);
      } finally {
        if (originalKey === undefined) {
          delete process.env.AGENT_SENTRY_ACCESS_KEY;
        } else {
          process.env.AGENT_SENTRY_ACCESS_KEY = originalKey;
        }
      }
    });

    it('should handle CORS preflight', async () => {
      httpTransport = createHttpTransport(0);
      await httpTransport.ready;
      const addr = httpTransport.server.address();
      if (!addr || typeof addr === 'string') return;

      const response = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
        method: 'OPTIONS',
      });
      expect(response.status).toBe(204);
    });

    it('should close cleanly', async () => {
      httpTransport = createHttpTransport(0);
      await httpTransport.ready;
      await httpTransport.close();
      httpTransport = null;
    });
  });
});
