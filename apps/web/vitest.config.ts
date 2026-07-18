import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Unit tests only — Playwright owns e2e/ (§17.1). */
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./*"]` — Next resolves this itself at build time,
    // but Vitest needs it spelled out to import route handlers / lib code directly.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    passWithNoTests: true,
    environment: 'node',
  },
});
