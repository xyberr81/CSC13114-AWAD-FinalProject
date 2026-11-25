import { defineConfig } from 'vitest/config';

// Local runs read .env if there is one; CI sets the variables itself.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // no .env at the repo root
}

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'contract',
          include: ['test/contract/**/*.test.ts'],
          globalSetup: ['test/contract/global-setup.ts'],
          testTimeout: 15_000,
        },
      },
      {
        // Needs PostgreSQL, like the contract tests; no Docker.
        test: {
          name: 'queue',
          include: ['test/queue/**/*.test.ts'],
          globalSetup: ['test/contract/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        // Needs Docker, so it is not part of `npm test`; CI runs it as its own job.
        test: {
          name: 'sandbox',
          include: ['test/sandbox/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 90_000,
        },
      },
    ],
  },
});
