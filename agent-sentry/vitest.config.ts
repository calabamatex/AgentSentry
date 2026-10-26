import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 10000,
    // Bound the worker pool. Vitest defaults to one fork per CPU core; each fork
    // loads the heavy e2e suite (real `npm install`/`npm pack` in temp dirs) and
    // the benchmark suites. On many-core machines that explodes memory — observed
    // at 20GB+ locally — and OOM-killed workers surface as intermittent
    // "Worker exited unexpectedly" / SIGTERM failures (the documented flake).
    // Capping concurrency keeps peak memory bounded while still parallelizing.
    // CI runners (~4 vCPU) are essentially unaffected; the cap only bites on
    // large dev boxes.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/version.ts', 'src/dashboard/html.ts'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // Regression floors, set below current measured coverage
      // (lines/statements ~85%, functions ~93%, branches ~83% as of 0.6.0-beta.1).
      // lines=80 mirrors the CI gate (.github/workflows/ci.yml); others guard against drift.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 85,
        branches: 75,
      },
    },
  },
});
