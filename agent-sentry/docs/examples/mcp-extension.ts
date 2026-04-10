/**
 * Example: Extending AgentSentry's MCP server with a custom tool.
 *
 * This shows how to create an MCP server that includes AgentSentry's
 * built-in tools plus your own custom tools.
 */

import { createMcpServer, MemoryStore, createProvider } from '@calabamatex/agentsentry';

async function main() {
  // 1. Create a memory store
  const store = new MemoryStore({
    provider: createProvider({ provider: 'sqlite', database_path: './data/ops.db' }),
  });
  await store.initialize();

  // 2. Create the MCP server (includes all 10 built-in tools)
  const server = createMcpServer({ memoryStore: store });

  // 3. The server is a standard @modelcontextprotocol/sdk Server instance.
  //    You can register additional tools, resources, or prompts on it.

  // Example: Add a custom tool that queries recent decisions
  // (In practice, you would use server.tool() from the MCP SDK)

  console.log('MCP server created with AgentSentry tools');

  // 4. To run as stdio transport (default for Claude Code):
  //    server.connect(new StdioServerTransport());

  await store.close();
}

main().catch(console.error);
