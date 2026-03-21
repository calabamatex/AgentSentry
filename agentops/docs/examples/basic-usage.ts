/**
 * basic-usage.ts — Illustrative example showing core MemoryStore operations.
 *
 * Demonstrates: creating a store, capturing events, searching, listing, and stats.
 * Run: npx ts-node docs/examples/basic-usage.ts
 */

import { MemoryStore, createProvider } from 'agentops';

async function main() {
  // 1. Create a MemoryStore backed by SQLite
  const store = new MemoryStore({
    provider: createProvider({ provider: 'sqlite', database_path: './example-ops.db' }),
  });
  await store.initialize();

  // 2. Capture some events
  await store.capture({
    timestamp: new Date().toISOString(),
    session_id: 'demo-session',
    agent_id: 'agent-1',
    event_type: 'decision',
    severity: 'low',
    skill: 'save_points',
    title: 'Created git stash before refactor',
    detail: 'Stashing uncommitted changes in auth module',
    affected_files: ['src/auth/login.ts'],
    tags: ['backup'],
    metadata: {},
  });

  await store.capture({
    timestamp: new Date().toISOString(),
    session_id: 'demo-session',
    agent_id: 'agent-1',
    event_type: 'violation',
    severity: 'high',
    skill: 'standing_orders',
    title: 'File saved to root directory',
    detail: 'utils.ts was saved to the project root, violating file org rules',
    affected_files: ['utils.ts'],
    tags: ['file-org'],
    metadata: {},
  });

  // 3. Search by text query
  const results = await store.search('auth refactor', { limit: 5 });
  console.log('Search results:');
  for (const { event, score } of results) {
    console.log(`  [${score.toFixed(2)}] ${event.title}`);
  }

  // 4. List events with filters
  const violations = await store.list({ event_type: 'violation', limit: 10 });
  console.log(`\nViolations found: ${violations.length}`);

  // 5. Aggregate stats
  const stats = await store.stats();
  console.log(`\nTotal events: ${stats.total_events}`);
  console.log('By severity:', stats.by_severity);

  // 6. Verify hash chain
  const chain = await store.verifyChain();
  console.log(`\nChain valid: ${chain.valid} (${chain.total_checked} checked)`);

  await store.close();
}

main().catch(console.error);
