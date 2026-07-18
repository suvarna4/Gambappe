import { defineConfig } from 'vitest/config';

/** Unit tests only — Playwright owns e2e/ (§17.1). */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    environment: 'node',
  },
});
