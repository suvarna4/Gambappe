import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Integration tests need a live Postgres (docker-compose or CI service). */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { '@': dirname },
  },
});
