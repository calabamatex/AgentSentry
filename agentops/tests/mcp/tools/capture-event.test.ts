/**
 * capture-event.test.ts — Tests for agentops_capture_event tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock MemoryStore before importing the handler
vi.mock('../../../src/memory/store', () => {
  const mockCapture = vi.fn().mockResolvedValue({
    id: 'test-id-123',
    timestamp: '2026-03-20T00:00:00.000Z',
    session_id: 'test-session',
    agent_id: 'mcp-server',
    event_type: 'decision',
    severity: 'low',
    skill: 'system',
    title: 'Test event',
    detail: 'Test detail',
    affected_files: [],
    tags: [],
    metadata: {},
    hash: 'abc123',
    prev_hash: '0'.repeat(64),
  });

  return {
    MemoryStore: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      capture: mockCapture,
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

import { handler } from '../../../src/mcp/tools/capture-event';
import { MemoryStore } from '../../../src/memory/store';

describe('agentops_capture_event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture a valid event', async () => {
    const result = await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test event',
      detail: 'Test detail',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.id).toBe('test-id-123');
    expect(parsed.event_type).toBe('decision');
    expect(parsed.severity).toBe('low');
  });

  it('should initialize and close the store', async () => {
    await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });

    const storeInstance = (MemoryStore as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(storeInstance.initialize).toHaveBeenCalled();
    expect(storeInstance.close).toHaveBeenCalled();
  });

  it('should pass affected_files and tags', async () => {
    await handler({
      event_type: 'violation',
      severity: 'high',
      skill: 'proactive_safety',
      title: 'Rule violation',
      detail: 'File was modified',
      affected_files: ['src/test.ts'],
      tags: ['safety', 'violation'],
    });

    const storeInstance = (MemoryStore as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    const captureCall = storeInstance.capture.mock.calls[0][0];
    expect(captureCall.affected_files).toEqual(['src/test.ts']);
    expect(captureCall.tags).toEqual(['safety', 'violation']);
  });

  it('should default affected_files and tags to empty arrays', async () => {
    await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });

    const storeInstance = (MemoryStore as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    const captureCall = storeInstance.capture.mock.calls[0][0];
    expect(captureCall.affected_files).toEqual([]);
    expect(captureCall.tags).toEqual([]);
  });

  it('should reject invalid event_type', async () => {
    const result = await handler({
      event_type: 'invalid_type',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBeDefined();
  });

  it('should reject invalid severity', async () => {
    const result = await handler({
      event_type: 'decision',
      severity: 'super_high',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBeDefined();
  });

  it('should reject missing required fields', async () => {
    const result = await handler({
      event_type: 'decision',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBeDefined();
  });

  it('should handle store errors gracefully', async () => {
    const storeModule = await import('../../../src/memory/store');
    (storeModule.MemoryStore as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      initialize: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      close: vi.fn().mockResolvedValue(undefined),
    }));

    const result = await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('DB connection failed');
  });
});
