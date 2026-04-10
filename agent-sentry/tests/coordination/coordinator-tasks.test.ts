import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskDelegator } from '../../src/coordination/coordinator-tasks';
import type { OpsEvent, OpsEventInput } from '../../src/memory/schema';

// Minimal in-memory mock of MemoryStore
function createMockStore() {
  const events: OpsEvent[] = [];
  return {
    events,
    capture: vi.fn(async (input: OpsEventInput): Promise<OpsEvent> => {
      const event: OpsEvent = {
        ...input,
        id: `evt-${events.length}`,
        hash: 'h' + events.length,
        prev_hash: events.length > 0 ? 'h' + (events.length - 1) : '0'.repeat(64),
      };
      events.push(event);
      return event;
    }),
    list: vi.fn(async () => [...events].reverse()),
    initialize: vi.fn(),
  };
}

describe('TaskDelegator', () => {
  let store: ReturnType<typeof createMockStore>;
  let delegator: TaskDelegator;

  beforeEach(() => {
    store = createMockStore();
    delegator = new TaskDelegator(store as any, 'agent-1');
  });

  describe('delegateTask', () => {
    it('creates a task and returns a task ID', async () => {
      const taskId = await delegator.delegateTask('agent-2', {
        name: 'build',
        params: { target: 'dist' },
      });

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      expect(taskId.length).toBeGreaterThan(0);
    });

    it('stores a task event via the memory store', async () => {
      await delegator.delegateTask('agent-2', {
        name: 'test',
        params: {},
      });

      expect(store.capture).toHaveBeenCalledTimes(1);
      const captured = store.capture.mock.calls[0][0] as OpsEventInput;
      expect(captured.event_type).toBe('decision');
      expect(captured.skill).toBe('system');
      expect(captured.tags).toContain('coordination:task');
      expect((captured.metadata as any).status).toBe('pending');
      expect((captured.metadata as any).name).toBe('test');
      expect((captured.metadata as any).from).toBe('agent-1');
      expect((captured.metadata as any).to).toBe('agent-2');
    });

    it('generates unique task IDs for each delegation', async () => {
      const id1 = await delegator.delegateTask('agent-2', { name: 'a', params: {} });
      const id2 = await delegator.delegateTask('agent-2', { name: 'b', params: {} });
      expect(id1).not.toBe(id2);
    });

    it('includes task params in metadata', async () => {
      await delegator.delegateTask('agent-3', {
        name: 'deploy',
        params: { env: 'prod', version: '1.0' },
      });

      const captured = store.capture.mock.calls[0][0] as OpsEventInput;
      expect((captured.metadata as any).params).toEqual({ env: 'prod', version: '1.0' });
    });
  });

  describe('reportTaskComplete', () => {
    it('stores a completion event', async () => {
      const taskId = await delegator.delegateTask('agent-2', { name: 'build', params: {} });
      await delegator.reportTaskComplete(taskId, { output: 'success' });

      expect(store.capture).toHaveBeenCalledTimes(2);
      const captured = store.capture.mock.calls[1][0] as OpsEventInput;
      expect((captured.metadata as any).status).toBe('complete');
      expect((captured.metadata as any).taskId).toBe(taskId);
      expect((captured.metadata as any).result).toEqual({ output: 'success' });
    });

    it('sets from field to the delegator agent ID', async () => {
      await delegator.reportTaskComplete('task-123', { done: true });

      const captured = store.capture.mock.calls[0][0] as OpsEventInput;
      expect((captured.metadata as any).from).toBe('agent-1');
    });
  });

  describe('getTaskStatus', () => {
    it('returns null for nonexistent task', async () => {
      const status = await delegator.getTaskStatus('nonexistent-id');
      expect(status).toBeNull();
    });

    it('returns pending status for a delegated task', async () => {
      const taskId = await delegator.delegateTask('agent-2', { name: 'build', params: {} });
      const status = await delegator.getTaskStatus(taskId);

      expect(status).not.toBeNull();
      expect(status!.status).toBe('pending');
    });

    it('returns complete status after reportTaskComplete', async () => {
      const taskId = await delegator.delegateTask('agent-2', { name: 'build', params: {} });
      await delegator.reportTaskComplete(taskId, { files: 3 });

      const status = await delegator.getTaskStatus(taskId);
      expect(status).not.toBeNull();
      expect(status!.status).toBe('complete');
      expect(status!.result).toEqual({ files: 3 });
    });

    it('terminal status wins over pending even if pending is newer', async () => {
      const taskId = await delegator.delegateTask('agent-2', { name: 'x', params: {} });

      // Manually insert a complete event with the same timestamp as the pending one
      const completeEvent: OpsEvent = {
        id: 'manual-complete',
        timestamp: store.events[0].timestamp, // same timestamp
        session_id: 'coordination',
        agent_id: 'agent-1',
        event_type: 'decision',
        severity: 'low',
        skill: 'system',
        title: `task:complete:${taskId}`,
        detail: '',
        affected_files: [],
        tags: ['coordination:task'],
        metadata: { taskId, status: 'complete', result: { ok: true }, from: '', to: '', name: '', params: {} },
        hash: 'hx',
        prev_hash: 'h0',
      };
      store.events.push(completeEvent);

      const status = await delegator.getTaskStatus(taskId);
      expect(status).not.toBeNull();
      expect(status!.status).toBe('complete');
    });

    it('handles multiple tasks independently', async () => {
      const id1 = await delegator.delegateTask('agent-2', { name: 'a', params: {} });
      const id2 = await delegator.delegateTask('agent-3', { name: 'b', params: {} });

      await delegator.reportTaskComplete(id1, { done: true });

      const s1 = await delegator.getTaskStatus(id1);
      const s2 = await delegator.getTaskStatus(id2);

      expect(s1!.status).toBe('complete');
      expect(s2!.status).toBe('pending');
    });
  });

  describe('buildTaskEvent (via delegateTask)', () => {
    it('sets correct title format', async () => {
      const taskId = await delegator.delegateTask('agent-2', { name: 'lint', params: {} });

      const captured = store.capture.mock.calls[0][0] as OpsEventInput;
      expect(captured.title).toBe(`task:pending:${taskId}`);
    });

    it('sets correct detail format', async () => {
      await delegator.delegateTask('agent-2', { name: 'lint', params: {} });

      const captured = store.capture.mock.calls[0][0] as OpsEventInput;
      expect(captured.detail).toContain('lint');
      expect(captured.detail).toContain('agent-1');
      expect(captured.detail).toContain('agent-2');
    });

    it('includes ISO timestamp', async () => {
      await delegator.delegateTask('agent-2', { name: 'x', params: {} });

      const captured = store.capture.mock.calls[0][0] as OpsEventInput;
      expect(() => new Date(captured.timestamp)).not.toThrow();
      expect(captured.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
