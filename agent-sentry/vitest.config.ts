import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 10000,
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
