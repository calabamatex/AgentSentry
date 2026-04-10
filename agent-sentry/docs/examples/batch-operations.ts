/**
 * batch-operations.ts — Illustrative example showing BatchProcessor usage.
 *
 * Demonstrates: bulk event capture and parallel search queries.
 * Run: npx ts-node docs/examples/batch-operations.ts
 */

import { MemoryStore, createProvider, BatchProcessor } from '@calabamatex/agentsentry';
import type { OpsEventInput } from '@calabamatex/agentsentry';

async function main() {
  const store = new MemoryStore({
    provider: createProvider({ provider: 'sqlite', database_path: './batch-example.db' }),
  });
  await store.initialize();

  const batch = new BatchProcessor({ store, batchSize: 50 });

  // Build a batch of events
  const events: OpsEventInput[] = [];
  for (let i = 0; i < 20; i++) {
    events.push({
      timestamp: new Date().toISOString(),
      session_id: 'batch-session',
      agent_id: `agent-${i % 3}`,
      event_type: i % 4 === 0 ? 'incident' : 'decision',
      severity: i % 5 === 0 ? 'high' : 'low',
      skill: 'save_points',
      title: `Batch event ${i}`,
      detail: `Detail for batch event number ${i}`,
      affected_files: [`src/module-${i}.ts`],
      tags: ['batch-demo'],
      metadata: { index: i },
    });
  }

  // Capture all events in one call
  const captureResult = await batch.captureBatch(events);
  console.log(`Captured: ${captureResult.captured.length} events`);
  console.log(`Errors: ${captureResult.errors.length}`);
  console.log(`Time: ${captureResult.totalTime.toFixed(1)}ms`);

  // Run multiple search queries in batch
  const searchResult = await batch.searchBatch(
    ['incident', 'module-5', 'batch event'],
    { limit: 5 },
  );
  console.log(`\nSearch batch results:`);
  for (const item of searchResult.results) {
    console.log(`  "${item.query}": ${item.results.length} hits`);
  }
  console.log(`Total search time: ${searchResult.totalTime.toFixed(1)}ms`);

  await store.close();
}

main().catch(console.error);
