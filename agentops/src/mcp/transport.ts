/**
 * transport.ts — Transport layer for AgentOps MCP server (stdio and HTTP).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
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
  close(): Promise<void>;
}

/**
 * Creates an HTTP transport that wraps the MCP server.
 * Validates access keys and applies rate limiting.
 *
 * @param port Port to listen on
 * @param accessKey Optional access key for authentication
 */
export function createHttpTransport(
  port: number,
  accessKey?: string,
): HttpTransportServer {
  const rateLimiter = createRateLimiter(100, 60000);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-agentops-key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Access key validation
    if (accessKey) {
      const headerKey = req.headers['x-agentops-key'] as string | undefined;
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
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

      // MCP JSON-RPC endpoint
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            // Store parsed body on request for downstream handling
            (req as IncomingMessage & { body: unknown }).body = parsed;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: { message: 'HTTP transport ready. Use stdio for full MCP protocol.' },
            }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    });
  });

  server.listen(port);

  return {
    server,
    port,
    async close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
