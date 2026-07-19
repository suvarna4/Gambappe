import type { Config } from 'tailwindcss';

import { colors, fonts, glows, motion } from './src/tokens.js';

/**
 * Shared Tailwind theme (design doc §10.4). apps/web pulls this in via `@config` so the
 * token values live in exactly one place (`src/tokens.ts`) instead of being duplicated
 * into a Tailwind-only config.
 *
 * SW0-T2: the font families lead with the `--font-*` CSS variables that `next/font` injects
 * in `apps/web/app/layout.tsx`, then fall back to the token stack. This keeps `tokens.ts` the
 * source of truth (the stack IS the token value) while letting the app prefer the locally
 * hosted webfont — no token value is mutated.
 */
const config: Config = {
  content: [],
  theme: {
    extend: {
      colors: {
        bg: colors.bg,
        surface: colors.surface,
        paper: colors.paper,
        ink: colors.ink,
        muted: colors.muted,
        'side-a': colors.sideA,
        'side-b': colors.sideB,
        win: colors.win,
        loss: colors.loss,
        gold: colors.gold,
        'glow-a': glows.sideA,
        'glow-b': glows.sideB,
      },
      fontFamily: {
        ui: ['var(--font-ui)', ...fonts.ui.split(', ')],
        mono: ['var(--font-mono)', ...fonts.mono.split(', ')],
        display: ['var(--font-display)', ...fonts.display.split(', ')],
      },
      transitionDuration: {
        'arm-flare': `${motion.armFlare}ms`,
        fling: `${motion.fling}ms`,
        snap: `${motion.snap}ms`,
        print: `${motion.print}ms`,
        stamp: `${motion.stamp}ms`,
      },
      animationDuration: {
        'arm-flare': `${motion.armFlare}ms`,
        fling: `${motion.fling}ms`,
        snap: `${motion.snap}ms`,
        print: `${motion.print}ms`,
        stamp: `${motion.stamp}ms`,
      },
    },
  },
};

export default config;
