import { defineConfig } from 'vitest/config';

// Local runs read .env if there is one; CI sets the variables itself.
try {
  process.loadEnvFile();
} catch {
  // no .env file
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
    ],
  },
});
