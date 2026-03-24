/**
 * coordinator-tasks.ts — Task delegation extracted from coordinator.ts.
 *
 * Keeps coordinator.ts under 500 lines by housing task lifecycle methods
 * (delegate, report complete, get status) and the task event builder.
 */

import { v4 as uuidv4 } from 'uuid';
import { MemoryStore } from '../memory/store';
import type { OpsEventInput } from '../memory/schema';

const SESSION_ID = 'coordination';
const TAG_TASK = 'coordination:task';

/**
 * Handles task delegation, completion reporting, and status queries
 * on behalf of the AgentCoordinator.
 */
export class TaskDelegator {
  constructor(
    private readonly store: MemoryStore,
    private readonly agentId: string,
  ) {}

  async delegateTask(
    toAgentId: string,
    task: { name: string; params: Record<string, unknown> },
  ): Promise<string> {
    const taskId = uuidv4();
    const event = this.buildTaskEvent({
      taskId,
      from: this.agentId,
      to: toAgentId,
      name: task.name,
      params: task.params,
      status: 'pending',
    });
    await this.store.capture(event);
    return taskId;
  }

  async reportTaskComplete(
    taskId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    const event = this.buildTaskEvent({
      taskId,
      from: this.agentId,
      to: '',
      name: '',
      params: {},
      status: 'complete',
      result,
    });
    await this.store.capture(event);
  }

  async getTaskStatus(
    taskId: string,
  ): Promise<{ status: string; result?: Record<string, unknown> } | null> {
    const events = await this.store.list({
      tag: TAG_TASK,
      event_type: 'decision',
      skill: 'system',
      limit: 500,
    });

    // Collect all events for this task and pick the terminal status.
    // Events come DESC by timestamp, but same-ms events may be unordered.
    // Terminal statuses (complete, failed) always win over pending.
    let best: { status: string; result?: Record<string, unknown>; ts: string } | null = null;
    const terminalStatuses = new Set(['complete', 'failed']);

    for (const evt of events) {
      const meta = evt.metadata as Record<string, unknown>;
      if (meta.taskId !== taskId) continue;
      const status = meta.status as string;
      const result = meta.result as Record<string, unknown> | undefined;

      if (!best) {
        best = { status, result, ts: evt.timestamp };
      } else if (terminalStatuses.has(status) && !terminalStatuses.has(best.status)) {
        best = { status, result, ts: evt.timestamp };
      } else if (evt.timestamp > best.ts) {
        best = { status, result, ts: evt.timestamp };
      }
    }

    if (!best) return null;
    return { status: best.status, result: best.result };
  }

  private buildTaskEvent(task: {
    taskId: string;
    from: string;
    to: string;
    name: string;
    params: Record<string, unknown>;
    status: string;
    result?: Record<string, unknown>;
  }): OpsEventInput {
    return {
      timestamp: new Date().toISOString(),
      session_id: SESSION_ID,
      agent_id: this.agentId,
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: `task:${task.status}:${task.taskId}`,
      detail: `Task ${task.name} ${task.status} (${task.from} -> ${task.to})`,
      affected_files: [],
      tags: [TAG_TASK],
      metadata: task,
    };
  }
}
