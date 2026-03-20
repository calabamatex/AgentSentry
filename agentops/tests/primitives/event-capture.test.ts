/**
 * Tests for event-capture primitive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureEvent } from '../../src/primitives/event-capture';

// Mock the MemoryStore
const mockCapture = vi.fn();
const mockInitialize = vi.fn();
const mockClose = vi.fn();

vi.mock('../../src/memory/store', () => ({
  MemoryStore: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    capture: mockCapture,
    close: mockClose,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInitialize.mockResolvedValue(undefined);
  mockClose.mockResolvedValue(undefined);
});

describe('captureEvent', () => {
  it('should capture an event with all required fields', async () => {
    const mockEvent = {
      id: 'test-id',
      timestamp: '2026-01-01T00:00:00.000Z',
      session_id: 'test-session',
      agent_id: 'test-agent',
      event_type: 'decision',
      severity: 'low',
      skill: 'save_points',
      title: 'Test event',
      detail: 'Test detail',
      affected_files: [],
      tags: [],
      metadata: {},
      hash: 'abc123',
      prev_hash: '000000',
    };
    mockCapture.mockResolvedValue(mockEvent);

    const result = await captureEvent({
      eventType: 'decision',
      severity: 'low',
      skill: 'save_points',
      title: 'Test event',
      detail: 'Test detail',
    });

    expect(mockInitialize).toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'decision',
        severity: 'low',
        skill: 'save_points',
        title: 'Test event',
        detail: 'Test detail',
      })
    );
    expect(mockClose).toHaveBeenCalled();
    expect(result).toEqual(mockEvent);
  });

  it('should use provided sessionId and agentId', async () => {
    mockCapture.mockResolvedValue({ id: 'test' });

    await captureEvent({
      eventType: 'violation',
      severity: 'high',
      skill: 'proactive_safety',
      title: 'Violation',
      detail: 'Details',
      sessionId: 'custom-session',
      agentId: 'custom-agent',
    });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'custom-session',
        agent_id: 'custom-agent',
      })
    );
  });

  it('should use default sessionId and agentId when not provided', async () => {
    mockCapture.mockResolvedValue({ id: 'test' });

    await captureEvent({
      eventType: 'pattern',
      severity: 'low',
      skill: 'system',
      title: 'Pattern',
      detail: 'Details',
    });

    const capturedInput = mockCapture.mock.calls[0][0];
    expect(capturedInput.session_id).toMatch(/^session-/);
    expect(capturedInput.agent_id).toBe('agentops-primitives');
  });

  it('should pass affected files and tags', async () => {
    mockCapture.mockResolvedValue({ id: 'test' });

    await captureEvent({
      eventType: 'incident',
      severity: 'critical',
      skill: 'save_points',
      title: 'Incident',
      detail: 'Details',
      affectedFiles: ['file1.ts', 'file2.ts'],
      tags: ['security', 'urgent'],
    });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        affected_files: ['file1.ts', 'file2.ts'],
        tags: ['security', 'urgent'],
      })
    );
  });

  it('should close store even on error', async () => {
    mockCapture.mockRejectedValue(new Error('capture failed'));

    await expect(
      captureEvent({
        eventType: 'decision',
        severity: 'low',
        skill: 'system',
        title: 'Test',
        detail: 'Detail',
      })
    ).rejects.toThrow('capture failed');

    expect(mockClose).toHaveBeenCalled();
  });

  it('should include timestamp in event input', async () => {
    mockCapture.mockResolvedValue({ id: 'test' });

    await captureEvent({
      eventType: 'audit_finding',
      severity: 'medium',
      skill: 'standing_orders',
      title: 'Audit',
      detail: 'Details',
    });

    const capturedInput = mockCapture.mock.calls[0][0];
    expect(capturedInput.timestamp).toBeDefined();
    expect(new Date(capturedInput.timestamp).getTime()).not.toBeNaN();
  });
});
