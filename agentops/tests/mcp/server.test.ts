/**
 * server.test.ts — Tests for MCP server tool registration and request routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpServer, tools } from '../../src/mcp/server';

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const handlers = new Map<string, Function>();
  return {
    Server: vi.fn().mockImplementation(() => ({
      setRequestHandler: vi.fn((schema: { method: string }, handler: Function) => {
        handlers.set(schema.method, handler);
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      _handlers: handlers,
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: { method: 'tools/list' },
  CallToolRequestSchema: { method: 'tools/call' },
}));

describe('MCP Server', () => {
  describe('tool registration', () => {
    it('should register all 9 tools', () => {
      expect(tools).toHaveLength(9);
    });

    it('should include all expected tool names', () => {
      const names = tools.map((t) => t.name);
      expect(names).toContain('agentops_check_git');
      expect(names).toContain('agentops_check_context');
      expect(names).toContain('agentops_check_rules');
      expect(names).toContain('agentops_size_task');
      expect(names).toContain('agentops_scan_security');
      expect(names).toContain('agentops_capture_event');
      expect(names).toContain('agentops_search_history');
      expect(names).toContain('agentops_health');
      expect(names).toContain('agentops_recall_context');
    });

    it('should have descriptions for all tools', () => {
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    });

    it('should have valid inputSchema for all tools', () => {
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.inputSchema.properties).toBeDefined();
        expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      }
    });
  });

  describe('request routing', () => {
    it('should create server and register handlers', () => {
      const server = createMcpServer();
      expect(server.setRequestHandler).toHaveBeenCalledTimes(2);
    });

    it('should list all tools via ListToolsRequestSchema handler', async () => {
      const server = createMcpServer();
      const handlers = (server as unknown as { _handlers: Map<string, Function> })._handlers;
      const listHandler = handlers.get('tools/list');
      expect(listHandler).toBeDefined();

      const result = await listHandler!({});
      expect(result.tools).toHaveLength(9);
      for (const tool of result.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
      }
    });

    it('should return error for unknown tool', async () => {
      const server = createMcpServer();
      const handlers = (server as unknown as { _handlers: Map<string, Function> })._handlers;
      const callHandler = handlers.get('tools/call');
      expect(callHandler).toBeDefined();

      const result = await callHandler!({
        params: { name: 'nonexistent_tool', arguments: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('should route to correct tool handler', async () => {
      const server = createMcpServer();
      const handlers = (server as unknown as { _handlers: Map<string, Function> })._handlers;
      const callHandler = handlers.get('tools/call');

      const result = await callHandler!({
        params: { name: 'agentops_check_context', arguments: { message_count: 5 } },
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.estimated_tokens).toBe(20000);
      expect(parsed.messages).toBe(5);
    });

    it('should handle missing arguments gracefully', async () => {
      const server = createMcpServer();
      const handlers = (server as unknown as { _handlers: Map<string, Function> })._handlers;
      const callHandler = handlers.get('tools/call');

      const result = await callHandler!({
        params: { name: 'agentops_check_context' },
      });

      // Should not error — message_count is optional
      expect(result.isError).toBeUndefined();
    });
  });
});
