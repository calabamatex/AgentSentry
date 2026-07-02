/**
 * transport.ts — Transport layer for AgentSentry MCP server (stdio and HTTP).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { validateAccessKey, createRateLimiter } from './auth';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'mcp-transport' });

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
  /** Resolves once the server is listening and `port` is set to the actual port. */
  ready: Promise<void>;
  close(): Promise<void>;
}

/**
 * Creates an HTTP transport that wraps the MCP server.
 * Validates access keys and applies rate limiting.
 * Uses the real StreamableHTTPServerTransport from the MCP SDK.
 *
 * @param port Port to listen on (use 0 for random available port)
 * @param host Optional interface to bind (e.g. '127.0.0.1' to restrict to loopback)
 *
 * Authentication is delegated to validateAccessKey(), which is fail-closed:
 * non-health requests are rejected unless AGENT_SENTRY_ACCESS_KEY is set (or
 * AGENT_SENTRY_NO_AUTH opts out for local dev). The /health endpoint is
 * intentionally unauthenticated so liveness probes work.
 */
export function createHttpTransport(
  port: number,
  host?: string,
): HttpTransportServer {
  const rateLimiter = createRateLimiter(100, 60000);

  const mcpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers. A wildcard origin is refused unless explicitly opted in,
    // to avoid silently exposing the tool surface cross-origin.
    let corsOrigin = process.env.AGENT_SENTRY_CORS_ORIGIN || 'http://localhost';
    if (corsOrigin === '*' && process.env.AGENT_SENTRY_ALLOW_WILDCARD_CORS !== '1') {
      logger.warn('Ignoring wildcard CORS origin; set AGENT_SENTRY_ALLOW_WILDCARD_CORS=1 to allow it');
      corsOrigin = 'http://localhost';
    }
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-agent-sentry-key, Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint — unauthenticated liveness probe (served before auth).
    if (req.method === 'GET' && (req.url === '/health' || req.url?.startsWith('/health?'))) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'http' }));
      return;
    }

    // Access key validation — fail closed for every non-health request.
    const providedKey = (req.headers['x-agent-sentry-key'] as string | undefined) ?? '';
    if (!validateAccessKey(providedKey)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing access key' }));
      return;
    }

    // Rate limiting
    rateLimiter.middleware(req, res, () => {
      // Delegate all other requests to the MCP StreamableHTTPServerTransport
      mcpTransport.handleRequest(req, res).catch((err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('MCP transport error', { error: errorMessage });
      });
    });
  });

  const ready = new Promise<void>((resolve) => {
    const onListen = () => {
      const addr = server.address() as AddressInfo;
      if (addr) {
        result.port = addr.port;
      }
      resolve();
    };
    // Bind to the requested host (e.g. loopback) when provided; otherwise all interfaces.
    if (host) {
      server.listen(port, host, onListen);
    } else {
      server.listen(port, onListen);
    }
  });

  const result: HttpTransportServer = {
    server,
    port,
    transport: mcpTransport,
    ready,
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

  return result;
}
