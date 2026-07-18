import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Unit tests only — Playwright owns e2e/ (§17.1). */
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./*"]` — Next resolves this itself at build time,
    // but Vitest needs it spelled out to import route handlers / lib code directly.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // tsconfig.json sets `"jsx": "preserve"` (Next's own bundler transforms it); Vitest's esbuild
  // pipeline needs its own JSX setting since it doesn't go through Next at all — automatic
  // runtime matches React 19 (no `import React` needed in `.tsx` test files, WS7-T2's
  // `question-state-view.test.tsx`).
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['test/integration/**'],
    passWithNoTests: true,
    environment: 'node',
  },
});
