/**
 * transport.ts — Transport layer for AgentOps MCP server (stdio and HTTP).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { validateAccessKey, createRateLimiter } from './auth';

/**
 * Creates a stdio transport for the MCP server.
 * Used for local CLI-based communication.
 */
export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

export interface HttpTransportServer {
  server: ReturnType<typeof createServer>;
  port: number;
  transport: StreamableHTTPServerTransport;
  close(): Promise<void>;
}

/**
 * Creates an HTTP transport that wraps the MCP server.
 * Validates access keys and applies rate limiting.
 * Uses the real StreamableHTTPServerTransport from the MCP SDK.
 *
 * @param port Port to listen on (use 0 for random available port)
 * @param accessKey Optional access key for authentication
 */
export function createHttpTransport(
  port: number,
  accessKey?: string,
): HttpTransportServer {
  const rateLimiter = createRateLimiter(100, 60000);

  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // Track the actual listening port (updated once server starts)
  let actualPort = port;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-agentops-key, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Access key validation
    if (accessKey) {
      const headerKey = req.headers['x-agentops-key'] as string | undefined;
      const url = new URL(req.url ?? '/', `http://localhost:${actualPort}`);
      const queryKey = url.searchParams.get('key') ?? undefined;
      const providedKey = headerKey ?? queryKey ?? '';

      if (!validateAccessKey(providedKey)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing access key' }));
        return;
      }
    }

    // Rate limiting
    rateLimiter.middleware(req, res, () => {
      // Health check endpoint
      if (req.method === 'GET' && (req.url === '/health' || req.url?.startsWith('/health?'))) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', transport: 'http' }));
        return;
      }

      // Delegate all other requests to the MCP StreamableHTTPServerTransport
      mcpTransport.handleRequest(req, res).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('MCP transport error:', errorMessage);
      });
    });
  });

  server.listen(port);

  const result: HttpTransportServer = {
    server,
    port,
    transport: mcpTransport,
    async close(): Promise<void> {
      await mcpTransport.close();
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };

  // Once the server is listening, update the port from the actual address
  // (important when port 0 is used for random assignment)
  server.on('listening', () => {
    const addr = server.address() as AddressInfo;
    if (addr) {
      actualPort = addr.port;
      result.port = addr.port;
    }
  });

  return result;
}
