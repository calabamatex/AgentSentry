/**
 * AgentCoordinator unit tests — single-machine coordination primitives.
 *
 * SEMANTICS: These tests validate best-effort, single-machine coordination.
 * The coordination layer is event-sourced and append-only. It does NOT provide:
 *  - Distributed consensus or cross-machine coordination
 *  - Compare-and-swap (CAS) atomicity
 *  - Guaranteed mutual exclusion under high concurrency
 *  - Background lease enforcement (expiry is checked at read time)
 *
 * See coordinator.ts and lease.ts headers for the full consistency model.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStore } from '../../src/memory/store';
import { SqliteProvider } from '../../src/memory/providers/sqlite-provider';
import { NoopEmbeddingProvider } from '../../src/memory/embeddings';
import { AgentCoordinator, CoordinatorOptions } from '../../src/coordination/coordinator';

let testDir: string;
let testDb: string;

function createStore(): MemoryStore {
  return new MemoryStore({
    provider: new SqliteProvider(testDb),
    embeddingProvider: new NoopEmbeddingProvider(),
  });
}

function createCoordinator(
  store: MemoryStore,
  overrides: Partial<CoordinatorOptions> = {},
): AgentCoordinator {
  return new AgentCoordinator({
    agentId: overrides.agentId ?? 'agent-1',
    agentName: overrides.agentName ?? 'Agent One',
    role: overrides.role ?? 'coder',
    capabilities: overrides.capabilities ?? ['typescript', 'testing'],
    store,
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? 100_000,
    lockTimeoutMs: overrides.lockTimeoutMs ?? 5_000,
  });
}

describe('AgentCoordinator', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-coord-'));
    testDb = path.join(testDir, 'test-coordination.db');

    store = createStore();
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Agent Discovery
  // -----------------------------------------------------------------------

  describe('Agent Registration & Discovery', () => {
    it('registers an agent and lists it', async () => {
      const coord = createCoordinator(store);
      await coord.start();

      const agents = await coord.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-1');
      expect(agents[0].name).toBe('Agent One');
      expect(agents[0].role).toBe('coder');
      expect(agents[0].status).toBe('active');

      await coord.stop();
    });

    it('registers two agents and lists both', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'Agent A',
        role: 'coder',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'Agent B',
        role: 'reviewer',
      });

      await coordA.start();
      await coordB.start();

      const agents = await coordA.listAgents();
      expect(agents).toHaveLength(2);
      const ids = agents.map((a) => a.id).sort();
      expect(ids).toEqual(['agent-a', 'agent-b']);

      await coordA.stop();
      await coordB.stop();
    });

    it('filters agents by role', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'Agent A',
        role: 'coder',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'Agent B',
        role: 'reviewer',
      });

      await coordA.start();
      await coordB.start();

      const coders = await coordA.listAgents({ role: 'coder' });
      expect(coders).toHaveLength(1);
      expect(coders[0].id).toBe('agent-a');

      await coordA.stop();
      await coordB.stop();
    });

    it('unregisters an agent', async () => {
      const coord = createCoordinator(store);
      await coord.start();

      let agents = await coord.listAgents();
      expect(agents).toHaveLength(1);

      await coord.stop();

      // Create a fresh coordinator to query (since coord stopped)
      const observer = createCoordinator(store, {
        agentId: 'observer',
        agentName: 'Observer',
      });
      await observer.start();

      // List all agents first, then check for offline
      const allAgents = await observer.listAgents();
      const agent1 = allAgents.find((a) => a.id === 'agent-1');
      expect(agent1).toBeDefined();
      expect(agent1!.status).toBe('offline');

      await observer.stop();
    });

    it('getAgent returns a specific agent', async () => {
      const coord = createCoordinator(store, {
        agentId: 'target',
        agentName: 'Target Agent',
      });
      await coord.start();

      const agent = await coord.getAgent('target');
      expect(agent).not.toBeNull();
      expect(agent!.name).toBe('Target Agent');

      const missing = await coord.getAgent('nonexistent');
      expect(missing).toBeNull();

      await coord.stop();
    });
  });

  // -----------------------------------------------------------------------
  // Heartbeat & Offline Detection
  // -----------------------------------------------------------------------

  describe('Heartbeat & Offline Detection', () => {
    it('heartbeat updates lastSeen', async () => {
      const coord = createCoordinator(store, {
        heartbeatIntervalMs: 50,
      });
      await coord.start();

      const before = await coord.getAgent('agent-1');
      const beforeSeen = before!.lastSeen;

      // Wait for a heartbeat cycle
      await new Promise((r) => setTimeout(r, 120));

      const after = await coord.getAgent('agent-1');
      expect(new Date(after!.lastSeen).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeSeen).getTime(),
      );

      await coord.stop();
    });

    it('marks agents with stale heartbeat as offline', async () => {
      // Create a coordinator with a very short heartbeat threshold
      const staleCoord = createCoordinator(store, {
        agentId: 'stale-agent',
        agentName: 'Stale',
        heartbeatIntervalMs: 10, // 10ms heartbeat -> 20ms offline threshold
      });
      await staleCoord.register();
      // Don't start heartbeat loop — just register once

      // Wait past the offline threshold
      await new Promise((r) => setTimeout(r, 50));

      // Observer uses same short interval so the threshold is 20ms
      const observer = createCoordinator(store, {
        agentId: 'observer',
        agentName: 'Observer',
        heartbeatIntervalMs: 10,
      });
      await observer.register();

      const agents = await observer.listAgents();
      const stale = agents.find((a) => a.id === 'stale-agent');
      expect(stale).toBeDefined();
      expect(stale!.status).toBe('offline');
    });
  });

  // -----------------------------------------------------------------------
  // Distributed Locking
  // -----------------------------------------------------------------------

  describe('Distributed Locking', () => {
    it('acquires and releases a lock', async () => {
      const coord = createCoordinator(store);
      await coord.start();

      const acquired = await coord.acquireLock('resource-1');
      expect(acquired).toBe(true);

      const lockInfo = await coord.isLocked('resource-1');
      expect(lockInfo).not.toBeNull();
      expect(lockInfo!.holder).toBe('agent-1');
      expect(lockInfo!.resource).toBe('resource-1');

      const released = await coord.releaseLock('resource-1');
      expect(released).toBe(true);

      const afterRelease = await coord.isLocked('resource-1');
      expect(afterRelease).toBeNull();

      await coord.stop();
    });

    it('prevents a second agent from acquiring a held lock', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      await coordA.start();
      await coordB.start();

      const gotA = await coordA.acquireLock('shared-resource');
      expect(gotA).toBe(true);

      const gotB = await coordB.acquireLock('shared-resource');
      expect(gotB).toBe(false);

      await coordA.stop();
      await coordB.stop();
    });

    it('allows re-entrant lock by same agent', async () => {
      const coord = createCoordinator(store);
      await coord.start();

      await coord.acquireLock('resource-1');
      const reacquired = await coord.acquireLock('resource-1');
      expect(reacquired).toBe(true);

      await coord.stop();
    });

    it('allows acquisition after lock expires', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      await coordA.start();
      await coordB.start();

      // Acquire with very short TTL
      const gotA = await coordA.acquireLock('expiring', 50);
      expect(gotA).toBe(true);

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 100));

      // Now agent B should be able to acquire
      const gotB = await coordB.acquireLock('expiring');
      expect(gotB).toBe(true);

      await coordA.stop();
      await coordB.stop();
    });

    it('release returns false if not holder', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      await coordA.start();
      await coordB.start();

      await coordA.acquireLock('resource');
      const released = await coordB.releaseLock('resource');
      expect(released).toBe(false);

      await coordA.stop();
      await coordB.stop();
    });

    it('isLocked returns null for unlocked resource', async () => {
      const coord = createCoordinator(store);
      await coord.start();

      const info = await coord.isLocked('nonexistent');
      expect(info).toBeNull();

      await coord.stop();
    });
  });

  // -----------------------------------------------------------------------
  // Message Passing
  // -----------------------------------------------------------------------

  describe('Message Passing', () => {
    it('sends a message from A to B, B receives it', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      await coordA.start();
      await coordB.start();

      await coordA.send('agent-b', 'work', { task: 'build' });

      const messages = await coordB.receive('work');
      expect(messages).toHaveLength(1);
      expect(messages[0].from).toBe('agent-a');
      expect(messages[0].payload).toEqual({ task: 'build' });

      await coordA.stop();
      await coordB.stop();
    });

    it('agent does not receive messages addressed to others', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      const coordC = createCoordinator(store, {
        agentId: 'agent-c',
        agentName: 'C',
      });
      await coordA.start();
      await coordB.start();
      await coordC.start();

      await coordA.send('agent-b', 'private', { secret: 'hi' });

      const bMessages = await coordB.receive('private');
      expect(bMessages).toHaveLength(1);

      const cMessages = await coordC.receive('private');
      expect(cMessages).toHaveLength(0);

      await coordA.stop();
      await coordB.stop();
      await coordC.stop();
    });

    it('broadcast sends to all agents', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      await coordA.start();
      await coordB.start();

      await coordA.broadcast('announcements', { msg: 'hello everyone' });

      const aMessages = await coordA.receive('announcements');
      expect(aMessages).toHaveLength(1);
      expect(aMessages[0].to).toBe('*');

      const bMessages = await coordB.receive('announcements');
      expect(bMessages).toHaveLength(1);
      expect(bMessages[0].payload).toEqual({ msg: 'hello everyone' });

      await coordA.stop();
      await coordB.stop();
    });

    it('receive with since filters by timestamp', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      await coordA.start();
      await coordB.start();

      await coordA.send('agent-b', 'events', { n: 1 });

      const cutoff = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 10));

      await coordA.send('agent-b', 'events', { n: 2 });

      const recent = await coordB.receive('events', cutoff);
      expect(recent).toHaveLength(1);
      expect(recent[0].payload).toEqual({ n: 2 });

      await coordA.stop();
      await coordB.stop();
    });

    it('onMessage / offMessage manage handlers', () => {
      const coord = createCoordinator(store);
      const handler = () => {};
      coord.onMessage('test', handler);
      // offMessage should not throw
      coord.offMessage('test');
      coord.offMessage('nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // Task Delegation
  // -----------------------------------------------------------------------

  describe('Task Delegation', () => {
    it('delegates a task and checks status', async () => {
      const coordA = createCoordinator(store, {
        agentId: 'agent-a',
        agentName: 'A',
      });
      const coordB = createCoordinator(store, {
        agentId: 'agent-b',
        agentName: 'B',
      });
      await coordA.start();
      await coordB.start();

      const taskId = await coordA.delegateTask('agent-b', {
        name: 'run-tests',
        params: { suite: 'unit' },
      });
      expect(taskId).toBeTruthy();

      const statusBefore = await coordA.getTaskStatus(taskId);
      expect(statusBefore).not.toBeNull();
      expect(statusBefore!.status).toBe('pending');

      await coordB.reportTaskComplete(taskId, { passed: 42, failed: 0 });

      const statusAfter = await coordA.getTaskStatus(taskId);
      expect(statusAfter).not.toBeNull();
      expect(statusAfter!.status).toBe('complete');
      expect(statusAfter!.result).toEqual({ passed: 42, failed: 0 });

      await coordA.stop();
      await coordB.stop();
    });

    it('getTaskStatus returns null for unknown task', async () => {
      const coord = createCoordinator(store);
      await coord.start();

      const status = await coord.getTaskStatus('nonexistent-id');
      expect(status).toBeNull();

      await coord.stop();
    });
  });

  // -----------------------------------------------------------------------
  // Documented Boundaries — what this module does NOT guarantee
  // -----------------------------------------------------------------------

  describe('Documented Boundaries (NOT supported)', () => {
    it('emits experimental warning on construction', async () => {
      // The coordinator must warn users that the API is experimental.
      // Logger.warn() writes JSON to stderr via process.stderr.write.
      const lines: string[] = [];
      const origWrite = process.stderr.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      }) as typeof process.stderr.write;

      try {
        delete process.env.AGENT_SENTRY_SUPPRESS_EXPERIMENTAL_WARN;
        const coord = createCoordinator(store, {
          agentId: 'warn-test',
          agentName: 'WarnTest',
        });
        expect(coord).toBeDefined();

        // Verify the warning was emitted as structured JSON
        const warnLine = lines.find((l) => l.includes('"level":"warn"'));
        expect(warnLine).toBeDefined();
        const parsed = JSON.parse(warnLine!);
        expect(parsed.msg).toContain('experimental');
        expect(parsed.msg).toContain('AGENT_SENTRY_SUPPRESS_EXPERIMENTAL_WARN');
      } finally {
        process.stderr.write = origWrite;
      }
    });

    it('suppresses experimental warning when env var is set', async () => {
      const lines: string[] = [];
      const origWrite = process.stderr.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      }) as typeof process.stderr.write;

      try {
        process.env.AGENT_SENTRY_SUPPRESS_EXPERIMENTAL_WARN = '1';
        const coord = createCoordinator(store, {
          agentId: 'suppress-test',
          agentName: 'SuppressTest',
        });
        expect(coord).toBeDefined();

        const warnLine = lines.find((l) => l.includes('"level":"warn"') && l.includes('experimental'));
        expect(warnLine).toBeUndefined();
      } finally {
        process.stderr.write = origWrite;
        delete process.env.AGENT_SENTRY_SUPPRESS_EXPERIMENTAL_WARN;
      }
    });

    it('locks are NOT enforced by a background reaper', async () => {
      // Expiry is checked at read time, not by a background process.
      // A lock with 1ms TTL remains "held" in the event log until
      // someone calls isLocked/acquireLock and the expiry check runs.
      const coord = createCoordinator(store, {
        agentId: 'reaper-test',
        agentName: 'ReaperTest',
      });
      await coord.start();

      // Acquire with very short TTL
      await coord.acquireLock('no-reaper-resource', 1);

      // The lock event exists in the store. Without a get/isLocked call,
      // no background process will clean it up. This is by design.
      // The test just documents this — the actual expiry behavior
      // is validated in the "allows acquisition after lock expires" test.

      await coord.stop();
    });

    it('concurrent acquire calls do not guarantee mutual exclusion', async () => {
      // This documents that under extreme concurrency, two agents could
      // both "succeed" at acquiring a lock if their event scans interleave
      // before either write lands. This is the known best-effort limitation.
      //
      // We do NOT test this failure mode because it is timing-dependent
      // and non-deterministic. This test simply documents the boundary.
      const coordA = createCoordinator(store, {
        agentId: 'race-a',
        agentName: 'RaceA',
      });
      await coordA.start();

      // Sequential acquire works correctly (tested elsewhere).
      // Truly concurrent acquire has no CAS guarantee.
      const acquired = await coordA.acquireLock('race-resource');
      expect(acquired).toBe(true);

      await coordA.stop();
    });
  });
});
