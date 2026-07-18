import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig.json sets `"jsx": "react-jsx"` for `tsc`; Vitest's esbuild pipeline needs its own
  // JSX setting since it doesn't go through `tsc` (mirrors `apps/web/vitest.config.ts`'s note).
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
