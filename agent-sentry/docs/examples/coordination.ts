/**
 * Example: Multi-agent coordination with AgentSentry.
 *
 * The AgentCoordinator provides event-sourced coordination for
 * multi-agent scenarios on a single machine.
 *
 * Status: Experimental — API may change.
 */

import {
  AgentCoordinator,
  MemoryStore,
  createProvider,
} from 'agent-sentry';
import type { AgentInfo, CoordinatorOptions } from 'agent-sentry';

async function main() {
  // 1. Create a shared memory store
  const store = new MemoryStore({
    provider: createProvider({ provider: 'sqlite', database_path: './data/ops.db' }),
  });
  await store.initialize();

  // 2. Create a coordinator
  const coordinator = new AgentCoordinator({
    store,
    agentId: 'coordinator-main',
    sessionId: 'session-001',
  } as CoordinatorOptions);

  // 3. Register agents
  const coder: AgentInfo = {
    id: 'agent-coder',
    name: 'Coder Agent',
    role: 'coder',
    status: 'active',
    registeredAt: new Date().toISOString(),
  };

  const reviewer: AgentInfo = {
    id: 'agent-reviewer',
    name: 'Reviewer Agent',
    role: 'reviewer',
    status: 'active',
    registeredAt: new Date().toISOString(),
  };

  await coordinator.registerAgent(coder);
  await coordinator.registerAgent(reviewer);

  // 4. Acquire a lock (prevents concurrent access to a resource)
  const lock = await coordinator.acquireLock('src/auth/session.ts', 'agent-coder');
  if (lock) {
    console.log(`Lock acquired by ${lock.agentId} on ${lock.resource}`);

    // Do work...

    await coordinator.releaseLock('src/auth/session.ts', 'agent-coder');
    console.log('Lock released');
  }

  // 5. Send coordination messages between agents
  await coordinator.sendMessage({
    from: 'agent-coder',
    to: 'agent-reviewer',
    type: 'review-request',
    payload: {
      files: ['src/auth/session.ts'],
      description: 'JWT refresh token implementation',
    },
    timestamp: new Date().toISOString(),
  });

  // 6. List all registered agents
  const agents = await coordinator.listAgents();
  console.log('Active agents:', agents.map((a) => a.name));

  await store.close();
}

main().catch(console.error);
