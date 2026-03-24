/**
 * run-benchmark.ts — Runs the AgentSentry benchmark suite and saves results.
 *
 * Usage: npx tsx scripts/run-benchmark.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStore } from '../src/memory/store';
import { SqliteProvider } from '../src/memory/providers/sqlite-provider';
import { BenchmarkSuite } from '../src/memory/benchmark';

async function main(): Promise<void> {
  const dbPath = path.join(__dirname, '..', '.benchmark-temp.db');

  // Clean up any previous temp DB
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  try {
    const provider = new SqliteProvider(dbPath);
    const store = new MemoryStore({ provider });
    await store.initialize();

    const suite = new BenchmarkSuite({ store, iterations: 500 });

    console.log('Running AgentSentry benchmark suite...\n');
    const report = await suite.runAll();

    // Print formatted report to stdout
    console.log(suite.formatReport(report));

    // Save JSON to benchmarks/baseline.json
    const outDir = path.join(__dirname, '..', 'benchmarks');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const outPath = path.join(outDir, 'baseline.json');
    fs.writeFileSync(outPath, suite.toJSON(report), 'utf-8');
    console.log(`\nResults saved to ${path.relative(process.cwd(), outPath)}`);

    await store.close();
  } finally {
    // Clean up temp DB
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
