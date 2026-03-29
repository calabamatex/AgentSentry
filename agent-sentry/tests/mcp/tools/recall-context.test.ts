/**
 * Tests for mcp/tools/recall-context.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRecall, mockRecallStore } = vi.hoisted(() => {
  const mockRecall = vi.fn();
  const mockRecallStore = {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockRecall, mockRecallStore };
});

vi.mock('../../../src/memory/intelligence', () => ({
  ContextRecaller: vi.fn().mockImplementation(() => ({
    recall: mockRecall,
  })),
}));

vi.mock('../../../src/mcp/shared-store', () => ({
  getSharedStore: vi.fn().mockResolvedValue(mockRecallStore),
}));

import { name, description, inputSchema, handler } from '../../../src/mcp/tools/recall-context';

describe('recall-context MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecall.mockResolvedValue({ results: [] });
  });

  it('has correct name and description', () => {
    expect(name).toBe('agent_sentry_recall_context');
    expect(description).toBeTruthy();
    expect(description).toContain('memory');
  });

  it('has correct input schema', () => {
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.required).toContain('query');
    expect(inputSchema.properties.query).toBeDefined();
    expect(inputSchema.properties.max_results).toBeDefined();
    expect(inputSchema.properties.lookback_days).toBeDefined();
  });

  it('rejects missing query', async () => {
    const result = await handler({});
    expect(result.content[0].text).toContain('Error');
  });

  it('rejects non-string query', async () => {
    const result = await handler({ query: 123 });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns results for valid query', async () => {
    // With a fresh store this should return "no relevant context"
    const result = await handler({ query: 'authentication patterns' });
    expect(result.content.length).toBe(1);
    expect(result.content[0].type).toBe('text');
    // Either finds something or says "no relevant context"
    expect(result.content[0].text).toBeTruthy();
  });
});
