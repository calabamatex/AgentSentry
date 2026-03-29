/**
 * capture-event.test.ts — Tests for agent_sentry_capture_event tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCaptureResult = {
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
};

const { mockStore, mockCapture } = vi.hoisted(() => {
  const mockCapture = vi.fn();
  const mockStore = {
    initialize: vi.fn().mockResolvedValue(undefined),
    capture: mockCapture,
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockStore, mockCapture };
});

// Mock shared-store singleton (tools now use getSharedStore())
vi.mock('../../../src/mcp/shared-store', () => ({
  getSharedStore: vi.fn().mockResolvedValue(mockStore),
}));

import { handler } from '../../../src/mcp/tools/capture-event';

describe('agent_sentry_capture_event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCapture.mockResolvedValue(mockCaptureResult);
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

  it('should call capture on the shared store', async () => {
    await handler({
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: 'Test',
      detail: 'Test',
    });

    expect(mockStore.capture).toHaveBeenCalled();
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

    const storeInstance = mockStore;
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

    const storeInstance = mockStore;
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
    mockCapture.mockRejectedValueOnce(new Error('DB connection failed'));

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
