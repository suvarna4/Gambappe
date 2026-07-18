import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Unit tests only — Playwright owns e2e/ (§17.1). */
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./*"]` — Next resolves this itself at build time,
    // but Vitest needs it spelled out to import route handlers / lib code directly.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  // WS8-T1: Next's SWC transforms .tsx with the automatic JSX runtime (no `React` import
  // needed, per the app-router convention already used by app/page.tsx etc.). Vitest's
  // esbuild transform defaults to the classic runtime, which fails at test time with
  // "React is not defined" for any lib/*.tsx satori template unless told to match.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    passWithNoTests: true,
    environment: 'node',
  },
});
