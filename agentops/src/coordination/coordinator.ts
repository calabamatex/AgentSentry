/**
 * coordinator.ts — Multi-agent coordination primitives for AgentOps.
 *
 * Provides agent discovery, distributed locking, message passing,
 * and task delegation using the MemoryStore as persistent backend.
 */

import { v4 as uuidv4 } from 'uuid';
import { MemoryStore } from '../memory/store';
import type { OpsEventInput } from '../memory/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_ID = 'coordination';
const TAG_REGISTRY = 'coordination:agent-registry';
const TAG_LOCK = 'coordination:lock';
const TAG_MESSAGE = 'coordination:message';
const TAG_TASK = 'coordination:task';

// ---------------------------------------------------------------------------
// AgentCoordinator
// ---------------------------------------------------------------------------

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
    this.agentId = options.agentId;
    this.agentName = options.agentName;
    this.role = options.role ?? 'default';
    this.capabilities = options.capabilities ?? [];
    this.store = options.store;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 60_000;
    this.messageHandlers = new Map();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Agent Discovery
  // -----------------------------------------------------------------------

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

    // Deduplicate by agent id — keep most recent event per agent
    const byAgent = new Map<string, AgentInfo>();
    for (const evt of events) {
      const info = evt.metadata as unknown as AgentInfo;
      if (!info?.id) continue;
      if (!byAgent.has(info.id)) {
        byAgent.set(info.id, info);
      }
      // events come desc by timestamp — first hit is most recent
    }

    const offlineThreshold = this.heartbeatIntervalMs * 2;
    const now = Date.now();

    const agents: AgentInfo[] = [];
    for (const info of byAgent.values()) {
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

  // -----------------------------------------------------------------------
  // Distributed Locking
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Message Passing
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Task Delegation
  // -----------------------------------------------------------------------

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

    // Find latest event for this task
    for (const evt of events) {
      const meta = evt.metadata as Record<string, unknown>;
      if (meta.taskId !== taskId) continue;
      return {
        status: meta.status as string,
        result: meta.result as Record<string, unknown> | undefined,
      };
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Event Builders (private)
  // -----------------------------------------------------------------------

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
