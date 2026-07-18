import { defineConfig } from 'vitest/config';

/** Integration tests need a live Postgres (docker-compose or CI service). */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
