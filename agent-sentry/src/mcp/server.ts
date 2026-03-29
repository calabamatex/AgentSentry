/**
 * server.ts — AgentSentry MCP Server: registers all tools and connects transports.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createStdioTransport, createHttpTransport } from './transport';
import { shutdownSharedStore } from './shared-store';
import { VERSION } from '../version';
import { Logger } from '../observability/logger';

const logger = new Logger({ module: 'mcp-server' });

// Import all tools
import * as checkGit from './tools/check-git';
import * as checkContext from './tools/check-context';
import * as checkRules from './tools/check-rules';
import * as sizeTask from './tools/size-task';
import * as scanSecurity from './tools/scan-security';
import * as captureEvent from './tools/capture-event';
import * as searchHistory from './tools/search-history';
import * as health from './tools/health';
import * as recallContext from './tools/recall-context';
import * as generateHandoff from './tools/generate-handoff';

/**
 * Tool definition with name, description, inputSchema, and handler.
 */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

/**
 * All registered tools.
 */
export const tools: ToolDefinition[] = [
  checkGit,
  checkContext,
  checkRules,
  sizeTask,
  scanSecurity,
  captureEvent,
  searchHistory,
  health,
  recallContext,
  generateHandoff,
];

const toolMap = new Map<string, ToolDefinition>();
for (const tool of tools) {
  toolMap.set(tool.name, tool);
}

/**
 * Create and configure the MCP server with all tools registered.
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'agent-sentry',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const tool = toolMap.get(toolName);

    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Unknown tool: ${toolName}. Available tools: ${tools.map((t) => t.name).join(', ')}`,
          },
        ],
      };
    }

    try {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const result = await tool.handler(args);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  });

  return server;
}

/**
 * Main entry point: parse CLI args and start the server.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isHttp = args.includes('--http');
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 3100;

  const server = createMcpServer();

  if (isHttp) {
    const accessKey = process.env.AGENT_SENTRY_ACCESS_KEY;
    const httpTransport = createHttpTransport(port, accessKey);
    await server.connect(httpTransport.transport);
    console.error(`AgentSentry MCP HTTP server listening on port ${httpTransport.port}`);

    const shutdown = async () => {
      await shutdownSharedStore();
      await httpTransport.close();
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    const transport = createStdioTransport();
    await server.connect(transport);
    console.error('AgentSentry MCP server running on stdio');
  }
}

// Run main if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
