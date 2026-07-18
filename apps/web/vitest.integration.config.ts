import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Integration tests need a live Postgres + Redis (docker-compose or CI service). */
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./*"]` (see vitest.config.ts for why this is needed).
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // WS8-T1: see vitest.config.ts — matches Next's automatic JSX runtime for the satori
  // OG templates exercised by the /api/og/* integration tests.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
