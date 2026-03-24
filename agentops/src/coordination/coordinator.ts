/**
 * coordinator.ts — Multi-agent coordination primitives for AgentSentry.
 *
 * [experimental] Single-machine, event-sourced coordination.
 * Not a distributed system. No consensus protocol. Best-effort only.
 *
 * Guarantees:
 *  - Append-only event log (events are never deleted)
 *  - Locks have TTL-based expiry (checked at read time)
 *  - No CAS/compare-and-swap — race conditions possible under concurrency
 *  - No cross-machine coordination
 *
 * See also: lease.ts for formal lease model with fencing tokens.
 */

import { v4 as uuidv4 } from 'uuid';
import { MemoryStore } from '../memory/store';
import { Logger } from '../observability/logger';
import type { OpsEventInput } from '../memory/schema';

const logger = new Logger({ module: 'coordinator' });

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'idle' | 'busy' | 'offline';
  lastSeen: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export interface LockInfo {
  resource: string;
  holder: string;
  acquiredAt: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

export interface CoordinationMessage {
  id: string;
  from: string;
  to: string | '*';
  type: 'request' | 'response' | 'notification' | 'heartbeat';
  channel: string;
  payload: Record<string, unknown>;
  timestamp: string;
  ttl?: number;
}

export interface CoordinatorOptions {
  agentId: string;
  agentName: string;
  role?: string;
  capabilities?: string[];
  store: MemoryStore;
  heartbeatIntervalMs?: number;
  lockTimeoutMs?: number;
}

const SESSION_ID = 'coordination';
const TAG_REGISTRY = 'coordination:agent-registry';
const TAG_LOCK = 'coordination:lock';
const TAG_MESSAGE = 'coordination:message';
const TAG_TASK = 'coordination:task';

export class AgentCoordinator {
  private agentId: string;
  private agentName: string;
  private role: string;
  private capabilities: string[];
  private store: MemoryStore;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private messageHandlers: Map<string, (msg: CoordinationMessage) => void | Promise<void>>;
  private heartbeatIntervalMs: number;
  private lockTimeoutMs: number;
  private started = false;

  constructor(options: CoordinatorOptions) {
    if (typeof process !== 'undefined' && process.env.AGENTOPS_SUPPRESS_EXPERIMENTAL_WARN !== '1') {
      logger.warn(
        'AgentCoordinator is experimental. API may change without notice. ' +
        'Set AGENTOPS_SUPPRESS_EXPERIMENTAL_WARN=1 to suppress this warning.',
      );
    }
    this.agentId = options.agentId;
    this.agentName = options.agentName;
    this.role = options.role ?? 'default';
    this.capabilities = options.capabilities ?? [];
    this.store = options.store;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 60_000;
    this.messageHandlers = new Map();
  }

  async start(): Promise<void> {
    await this.register();
    this.heartbeatInterval = setInterval(
      () => void this.heartbeat(),
      this.heartbeatIntervalMs,
    );
    this.started = true;
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    await this.unregister();
    this.started = false;
  }

  async register(): Promise<void> {
    const info: AgentInfo = {
      id: this.agentId,
      name: this.agentName,
      role: this.role,
      status: 'active',
      lastSeen: new Date().toISOString(),
      capabilities: this.capabilities,
      metadata: {},
    };
    await this.store.capture(this.buildRegistryEvent(info));
  }

  async unregister(): Promise<void> {
    const info: AgentInfo = {
      id: this.agentId,
      name: this.agentName,
      role: this.role,
      status: 'offline',
      lastSeen: new Date().toISOString(),
      capabilities: this.capabilities,
      metadata: {},
    };
    await this.store.capture(this.buildRegistryEvent(info));
  }

  async listAgents(filter?: { role?: string; status?: string }): Promise<AgentInfo[]> {
    const events = await this.store.list({
      tag: TAG_REGISTRY,
      event_type: 'pattern',
      skill: 'system',
      limit: 500,
    });

    // Deduplicate by agent id — keep most recent event per agent.
    // Events come DESC by timestamp but same-ms events may be unordered,
    // so we track by event timestamp and prefer later or same-timestamp
    // events that indicate a status change (e.g., offline wins ties).
    const byAgent = new Map<string, { info: AgentInfo; eventTs: string }>();
    for (const evt of events) {
      const info = evt.metadata as unknown as AgentInfo;
      if (!info?.id) continue;
      const existing = byAgent.get(info.id);
      if (!existing) {
        byAgent.set(info.id, { info, eventTs: evt.timestamp });
      } else if (
        evt.timestamp > existing.eventTs ||
        (evt.timestamp === existing.eventTs && info.status === 'offline')
      ) {
        byAgent.set(info.id, { info, eventTs: evt.timestamp });
      }
    }

    const offlineThreshold = this.heartbeatIntervalMs * 2;
    const now = Date.now();

    const agents: AgentInfo[] = [];
    for (const { info } of byAgent.values()) {
      const elapsed = now - new Date(info.lastSeen).getTime();
      if (info.status !== 'offline' && elapsed > offlineThreshold) {
        info.status = 'offline';
      }
      if (filter?.role && info.role !== filter.role) continue;
      if (filter?.status && info.status !== filter.status) continue;
      agents.push(info);
    }

    return agents;
  }

  async getAgent(agentId: string): Promise<AgentInfo | null> {
    const agents = await this.listAgents();
    return agents.find((a) => a.id === agentId) ?? null;
  }

  private async heartbeat(): Promise<void> {
    const info: AgentInfo = {
      id: this.agentId,
      name: this.agentName,
      role: this.role,
      status: 'active',
      lastSeen: new Date().toISOString(),
      capabilities: this.capabilities,
      metadata: {},
    };
    await this.store.capture(this.buildRegistryEvent(info));
  }

  /**
   * Attempts to acquire a lock on a resource.
   *
   * WARNING: This implementation uses check-then-act without atomicity guarantees.
   * Two agents calling acquireLock() concurrently may both succeed, as there is no
   * compare-and-swap (CAS) mechanism. For correctness-critical coordination,
   * use LeaseManager which provides fencing tokens.
   *
   * @param resource - The resource identifier to lock
   * @param ttlMs - Optional time-to-live in milliseconds
   * @returns true if the lock was acquired (or re-entered), false if held by another agent
   */
  async acquireLock(resource: string, ttlMs?: number): Promise<boolean> {
    await this.cleanExpiredLocks();

    const existing = await this.isLocked(resource);
    if (existing && existing.holder !== this.agentId) {
      return false;
    }
    if (existing && existing.holder === this.agentId) {
      return true; // re-entrant
    }

    const timeout = ttlMs ?? this.lockTimeoutMs;
    const now = new Date();
    const lockInfo: LockInfo = {
      resource,
      holder: this.agentId,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeout).toISOString(),
    };

    await this.store.capture(this.buildLockEvent(lockInfo, 'acquire'));
    logger.debug('Lock acquired (non-atomic)', { resource, holder: this.agentId });
    return true;
  }

  async releaseLock(resource: string): Promise<boolean> {
    const existing = await this.isLocked(resource);
    if (!existing || existing.holder !== this.agentId) {
      return false;
    }

    const lockInfo: LockInfo = {
      resource,
      holder: this.agentId,
      acquiredAt: existing.acquiredAt,
      expiresAt: existing.expiresAt,
    };

    await this.store.capture(this.buildLockEvent(lockInfo, 'release'));
    return true;
  }

  async isLocked(resource: string): Promise<LockInfo | null> {
    const events = await this.store.list({
      tag: TAG_LOCK,
      event_type: 'decision',
      skill: 'system',
      limit: 500,
    });

    // Collect all lock events for this resource, find most recent by title id
    // Events are DESC by timestamp but same-ms events may be unordered,
    // so we scan all events and use the event id (uuid) embedded in the
    // OpsEvent to find the actual latest by matching insertion order.
    // Since the store returns DESC and we only care about the most recent
    // action, we collect the first acquire/release per resource.
    // But because same-timestamp events may be mis-ordered, we need to
    // look at all events and pick the one with the latest timestamp,
    // breaking ties by checking if there's a release that references
    // the same acquiredAt as the acquire.
    let latestAction: string | null = null;
    let latestLock: LockInfo | null = null;
    let latestTimestamp = '';

    for (const evt of events) {
      const meta = evt.metadata as Record<string, unknown>;
      const lockInfo = meta.lock as LockInfo | undefined;
      const action = meta.action as string | undefined;
      if (!lockInfo || lockInfo.resource !== resource) continue;

      // Use event timestamp for ordering; for same timestamp, release wins
      // because release can only happen after acquire
      if (
        evt.timestamp > latestTimestamp ||
        (evt.timestamp === latestTimestamp && action === 'release')
      ) {
        latestTimestamp = evt.timestamp;
        latestAction = action ?? null;
        latestLock = lockInfo;
      }
    }

    if (!latestLock || latestAction === 'release') return null;

    // Check expiry
    if (new Date(latestLock.expiresAt).getTime() < Date.now()) {
      return null;
    }

    return latestLock;
  }

  private async cleanExpiredLocks(): Promise<number> {
    // Cleaning is implicit — isLocked ignores expired locks
    // We don't delete events from the append-only store
    return 0;
  }

  async send(
    to: string,
    channel: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const msg: CoordinationMessage = {
      id: uuidv4(),
      from: this.agentId,
      to,
      type: 'notification',
      channel,
      payload,
      timestamp: new Date().toISOString(),
    };
    await this.store.capture(this.buildMessageEvent(msg));
  }

  async broadcast(
    channel: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const msg: CoordinationMessage = {
      id: uuidv4(),
      from: this.agentId,
      to: '*',
      type: 'notification',
      channel,
      payload,
      timestamp: new Date().toISOString(),
    };
    await this.store.capture(this.buildMessageEvent(msg));
  }

  async receive(channel: string, since?: string): Promise<CoordinationMessage[]> {
    const events = await this.store.list({
      tag: TAG_MESSAGE,
      event_type: 'decision',
      skill: 'system',
      since,
      limit: 500,
    });

    const messages: CoordinationMessage[] = [];
    for (const evt of events) {
      const msg = evt.metadata as unknown as CoordinationMessage;
      if (!msg?.channel || msg.channel !== channel) continue;
      if (msg.to !== '*' && msg.to !== this.agentId) continue;
      // Apply strict "after" filter using message timestamp (since uses >=)
      if (since && msg.timestamp <= since) continue;
      messages.push(msg);
    }

    return messages;
  }

  onMessage(
    channel: string,
    handler: (msg: CoordinationMessage) => void | Promise<void>,
  ): void {
    this.messageHandlers.set(channel, handler);
  }

  offMessage(channel: string): void {
    this.messageHandlers.delete(channel);
  }

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

  private buildRegistryEvent(info: AgentInfo): OpsEventInput {
    return {
      timestamp: new Date().toISOString(),
      session_id: SESSION_ID,
      agent_id: this.agentId,
      event_type: 'pattern',
      severity: 'low',
      skill: 'system',
      title: `agent-registry:${info.id}`,
      detail: `Agent ${info.name} (${info.role}) status: ${info.status}`,
      affected_files: [],
      tags: [TAG_REGISTRY],
      metadata: info as unknown as Record<string, unknown>,
    };
  }

  private buildLockEvent(
    lock: LockInfo,
    action: 'acquire' | 'release',
  ): OpsEventInput {
    return {
      timestamp: new Date().toISOString(),
      session_id: SESSION_ID,
      agent_id: this.agentId,
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: `lock:${action}:${lock.resource}`,
      detail: `Lock ${action} on ${lock.resource} by ${lock.holder}`,
      affected_files: [],
      tags: [TAG_LOCK],
      metadata: { lock, action },
    };
  }

  private buildMessageEvent(msg: CoordinationMessage): OpsEventInput {
    return {
      timestamp: new Date().toISOString(),
      session_id: SESSION_ID,
      agent_id: this.agentId,
      event_type: 'decision',
      severity: 'low',
      skill: 'system',
      title: `msg:${msg.channel}:${msg.from}->${msg.to}`,
      detail: `Message on channel ${msg.channel}`,
      affected_files: [],
      tags: [TAG_MESSAGE],
      metadata: msg as unknown as Record<string, unknown>,
    };
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
