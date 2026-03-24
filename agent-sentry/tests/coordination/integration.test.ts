/**
 * Coordination integration test — 3 agents with concurrent locks.
 *
 * SEMANTICS: These tests validate best-effort, single-machine coordination.
 * The coordination layer is event-sourced and append-only. It does NOT provide:
 *  - Distributed consensus or cross-machine coordination
 *  - Compare-and-swap (CAS) atomicity
 *  - Guaranteed mutual exclusion under high concurrency
 *  - Background lease enforcement (expiry is checked at read time)
 *
 * These tests verify the happy path and basic contention scenarios.
 * They should not be interpreted as proof of distributed correctness.
 *
 * WS-3-4: Tests lock acquire/release, expiry, lease semantics,
 * and messaging under concurrent access.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store';
import { AgentCoordinator } from '../../src/coordination/coordinator';
import { LeaseManager } from '../../src/coordination/lease';

function createTestStore(): MemoryStore {
  return new MemoryStore({
    config: {
      enabled: true,
      provider: 'sqlite',
      embedding_provider: 'noop',
      database_path: ':memory:',
      max_events: 100000,
      auto_prune_days: 365,
    },
  });
}

describe('Coordination Integration', { timeout: 60000 }, () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = createTestStore();
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  describe('3-agent lock contention', () => {
    it('only one agent can hold a lock at a time', async () => {
      const agents = Array.from({ length: 3 }, (_, i) =>
        new AgentCoordinator({
          agentId: `agent-${i}`,
          agentName: `Agent ${i}`,
          role: 'worker',
          store,
          heartbeatIntervalMs: 600000, // disable heartbeat in test
          lockTimeoutMs: 60000,
        }),
      );

      // Agent 0 acquires the lock
      const acquired0 = await agents[0].acquireLock('shared-resource');
      expect(acquired0).toBe(true);

      // Agents 1 and 2 cannot acquire
      const acquired1 = await agents[1].acquireLock('shared-resource');
      const acquired2 = await agents[2].acquireLock('shared-resource');
      expect(acquired1).toBe(false);
      expect(acquired2).toBe(false);

      // Agent 0 releases
      const released = await agents[0].releaseLock('shared-resource');
      expect(released).toBe(true);

      // Now agent 1 can acquire
      const acquired1After = await agents[1].acquireLock('shared-resource');
      expect(acquired1After).toBe(true);

      // Agent 2 still cannot
      const acquired2After = await agents[2].acquireLock('shared-resource');
      expect(acquired2After).toBe(false);

      // Cleanup
      await agents[1].releaseLock('shared-resource');
    });

    it('re-entrant lock succeeds for same holder', async () => {
      const agent = new AgentCoordinator({
        agentId: 'agent-reentrant',
        agentName: 'ReentrantAgent',
        store,
        heartbeatIntervalMs: 600000,
        lockTimeoutMs: 60000,
      });

      expect(await agent.acquireLock('resource-a')).toBe(true);
      expect(await agent.acquireLock('resource-a')).toBe(true); // re-entrant
      await agent.releaseLock('resource-a');
    });

    it('expired locks can be acquired by other agents', async () => {
      const agent0 = new AgentCoordinator({
        agentId: 'agent-exp-0',
        agentName: 'Agent0',
        store,
        heartbeatIntervalMs: 600000,
        lockTimeoutMs: 1, // 1ms TTL — will expire immediately
      });
      const agent1 = new AgentCoordinator({
        agentId: 'agent-exp-1',
        agentName: 'Agent1',
        store,
        heartbeatIntervalMs: 600000,
        lockTimeoutMs: 60000,
      });

      await agent0.acquireLock('expiring-resource', 1);
      // Wait for expiry
      await new Promise(r => setTimeout(r, 10));

      // Agent 1 should be able to acquire since the lock expired
      const acquired = await agent1.acquireLock('expiring-resource');
      expect(acquired).toBe(true);

      await agent1.releaseLock('expiring-resource');
    });
  });

  describe('Messaging', () => {
    it('agents can send and receive messages', async () => {
      const sender = new AgentCoordinator({
        agentId: 'sender',
        agentName: 'Sender',
        store,
        heartbeatIntervalMs: 600000,
      });
      const receiver = new AgentCoordinator({
        agentId: 'receiver',
        agentName: 'Receiver',
        store,
        heartbeatIntervalMs: 600000,
      });

      const before = new Date(Date.now() - 1000).toISOString();
      await sender.send('receiver', 'tasks', { action: 'build', target: 'src/' });

      const messages = await receiver.receive('tasks', before);
      expect(messages.length).toBe(1);
      expect(messages[0].from).toBe('sender');
      expect(messages[0].payload).toEqual({ action: 'build', target: 'src/' });
    });

    it('broadcast reaches all agents', async () => {
      const broadcaster = new AgentCoordinator({
        agentId: 'broadcaster',
        agentName: 'Broadcaster',
        store,
        heartbeatIntervalMs: 600000,
      });

      const before = new Date(Date.now() - 1000).toISOString();
      await broadcaster.broadcast('alerts', { level: 'warning', msg: 'test' });

      // Any agent should see it
      const listener = new AgentCoordinator({
        agentId: 'listener',
        agentName: 'Listener',
        store,
        heartbeatIntervalMs: 600000,
      });

      const messages = await listener.receive('alerts', before);
      expect(messages.length).toBe(1);
      expect(messages[0].to).toBe('*');
    });
  });

  describe('LeaseManager', () => {
    it('lease acquire and release cycle', async () => {
      const lm = new LeaseManager({ store, defaultTtlMs: 60000 });

      const lease = await lm.acquire('db-write', 'agent-a');
      expect(lease).not.toBeNull();
      expect(lease!.resource).toBe('db-write');
      expect(lease!.holder).toBe('agent-a');
      expect(lease!.fencingToken).toBeGreaterThan(0);

      const released = await lm.release('db-write', 'agent-a');
      expect(released).toBe(true);

      const after = await lm.get('db-write');
      expect(after).toBeNull();
    });

    it('fencing token increases monotonically', async () => {
      const lm = new LeaseManager({ store, defaultTtlMs: 60000 });

      const lease1 = await lm.acquire('res-1', 'holder-a');
      await lm.release('res-1', 'holder-a');

      const lease2 = await lm.acquire('res-1', 'holder-b');
      expect(lease2!.fencingToken).toBeGreaterThan(lease1!.fencingToken);

      await lm.release('res-1', 'holder-b');
    });

    it('validates fencing tokens', async () => {
      const lm = new LeaseManager({ store, defaultTtlMs: 60000 });

      const lease = await lm.acquire('fenced-res', 'holder-a');
      expect(await lm.validateFencingToken('fenced-res', lease!.fencingToken)).toBe(true);
      expect(await lm.validateFencingToken('fenced-res', lease!.fencingToken - 1)).toBe(false);

      await lm.release('fenced-res', 'holder-a');
    });

    it('renewal extends TTL and increments renewCount', async () => {
      // Use a generous TTL to avoid expiry between acquire and renew
      const lm = new LeaseManager({ store, defaultTtlMs: 60000, maxRenewals: 3 });

      const original = await lm.acquire('renew-res', 'holder');
      expect(original).not.toBeNull();
      expect(original!.renewCount).toBe(0);

      const renewed = await lm.renew('renew-res', 'holder');
      expect(renewed).not.toBeNull();
      expect(renewed!.renewCount).toBe(1);

      // Verify TTL was extended: renewed expiry should be after original expiry
      expect(new Date(renewed!.expiresAt).getTime()).toBeGreaterThan(
        new Date(original!.expiresAt).getTime(),
      );

      await lm.release('renew-res', 'holder');
    });

    it('max renewals enforced', async () => {
      const lm = new LeaseManager({ store, defaultTtlMs: 60000, maxRenewals: 2 });

      await lm.acquire('limit-res', 'holder');
      await lm.renew('limit-res', 'holder');
      await lm.renew('limit-res', 'holder');

      // 3rd renewal should fail
      const result = await lm.renew('limit-res', 'holder');
      expect(result).toBeNull();

      await lm.release('limit-res', 'holder');
    });

    it('listActive returns only non-expired, non-released leases', async () => {
      const lm = new LeaseManager({ store, defaultTtlMs: 60000 });

      await lm.acquire('active-1', 'holder-a');
      await lm.acquire('active-2', 'holder-b');
      await lm.acquire('released-1', 'holder-c');
      await lm.release('released-1', 'holder-c');

      const active = await lm.listActive();
      const resources = active.map(l => l.resource);
      expect(resources).toContain('active-1');
      expect(resources).toContain('active-2');
      expect(resources).not.toContain('released-1');

      await lm.release('active-1', 'holder-a');
      await lm.release('active-2', 'holder-b');
    });
  });

  describe('Task delegation', () => {
    it('delegate and complete a task', async () => {
      const leader = new AgentCoordinator({
        agentId: 'leader',
        agentName: 'Leader',
        store,
        heartbeatIntervalMs: 600000,
      });
      const worker = new AgentCoordinator({
        agentId: 'worker',
        agentName: 'Worker',
        store,
        heartbeatIntervalMs: 600000,
      });

      const taskId = await leader.delegateTask('worker', {
        name: 'build',
        params: { target: 'dist/' },
      });

      const pending = await leader.getTaskStatus(taskId);
      expect(pending?.status).toBe('pending');

      await worker.reportTaskComplete(taskId, { success: true, artifacts: ['dist/index.js'] });

      const complete = await leader.getTaskStatus(taskId);
      expect(complete?.status).toBe('complete');
      expect(complete?.result).toEqual({ success: true, artifacts: ['dist/index.js'] });
    });
  });
});
