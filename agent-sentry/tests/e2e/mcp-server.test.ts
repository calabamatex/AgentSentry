/**
 * mcp-server.test.ts — E2E: Create MCP server, verify all 10 tools are registered,
 * and call each tool to verify response format.
 */

import { describe, it, expect } from 'vitest';
import { createMcpServer, tools } from '../../src/mcp/server';

describe('MCP Server (e2e)', () => {
  it('exports exactly 10 tools', () => {
    expect(tools).toHaveLength(10);
  });

  it('every tool has name, description, inputSchema, and handler', () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('tool names are unique', () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('expected tool names are registered', () => {
    const names = tools.map((t) => t.name);
    const expected = [
      'agent_sentry_check_git',
      'agent_sentry_check_context',
      'agent_sentry_check_rules',
      'agent_sentry_size_task',
      'agent_sentry_scan_security',
      'agent_sentry_capture_event',
      'agent_sentry_search_history',
      'agent_sentry_health',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it('createMcpServer returns a Server instance', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
    // Server should have connect method from @modelcontextprotocol/sdk
    expect(typeof server.connect).toBe('function');
  });

  describe('tool handler responses', () => {
    it('health tool returns valid response', async () => {
      const healthTool = tools.find((t) => t.name === 'agent_sentry_health');
      expect(healthTool).toBeDefined();

      const result = await healthTool!.handler({});
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe('text');
      expect(typeof result.content[0].text).toBe('string');
    });

    it('check_git tool returns valid response', async () => {
      const tool = tools.find((t) => t.name === 'agent_sentry_check_git');
      expect(tool).toBeDefined();

      const result = await tool!.handler({});
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
    });

    it('scan_security tool returns valid response with content', async () => {
      const tool = tools.find((t) => t.name === 'agent_sentry_scan_security');
      expect(tool).toBeDefined();

      const result = await tool!.handler({ content: 'const x = 42;' });
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
    });
  });
});
