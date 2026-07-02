/**
 * run-benchmark.ts — Runs the AgentSentry benchmark suite and saves results.
 *
 * Usage:
 *   npx tsx scripts/run-benchmark.ts                  # writes benchmarks/results-<ts>.json (gitignored)
 *   npx tsx scripts/run-benchmark.ts --update-baseline  # overwrites the tracked benchmarks/baseline.json
 *
 * baseline.json is an INFORMATIONAL reference run (it embeds the capture
 * platform in its `system` block); the regression test uses hardcoded
 * catastrophe thresholds, not this file. Only refresh it deliberately, on a
 * quiet machine of the platform you intend to document (WI-023).
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

    const outDir = path.join(__dirname, '..', 'benchmarks');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Default: write a gitignored timestamped results file so `npm run
    // benchmark` never dirties the tracked baseline. --update-baseline
    // deliberately refreshes benchmarks/baseline.json.
    const updateBaseline = process.argv.includes('--update-baseline');
    const fileName = updateBaseline
      ? 'baseline.json'
      : `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const outPath = path.join(outDir, fileName);
    fs.writeFileSync(outPath, suite.toJSON(report), 'utf-8');
    console.log(`\nResults saved to ${path.relative(process.cwd(), outPath)}`);
    if (!updateBaseline) {
      console.log('(Pass --update-baseline to overwrite the tracked reference run.)');
    }

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
