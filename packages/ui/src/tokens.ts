/**
 * Design tokens (design doc §10.4). Single source of truth: the Tailwind theme
 * (`../tailwind.config.ts`) extends from these same values, and any future non-Tailwind
 * consumer (e.g. a WS8 satori/OG template needing inline styles) should import from here
 * rather than re-declaring hex values.
 */

export const colors = {
  bg: '#0B0B0D',
  surface: '#141417',
  paper: '#F4F1E8',
  ink: '#111111',
  muted: '#8B8B93',
  sideA: '#3B82F6',
  sideB: '#F97316',
  win: '#2DD4A7',
  loss: '#F43F5E',
  /**
   * SW0-T2 (D-SW1): the streak/called-it/ritual accent. Reserved by convention for the
   * gold-foil stamp, streak flame, and reveal ritual beats — never a general-purpose
   * highlight (the whole point of gold is scarcity, swipe-ux-plan §2.7). On paper stock
   * this fails AA; use `#B8860B` there (the Print-Shop `printShop.gold`, §2.1).
   */
  gold: '#FFC53D',
} as const;

/**
 * SW0-T2 (D-SW1): translucent side accents for the swipe world-tint and rail gradients —
 * the "energy from light, not new hues" direction. Alpha forms of `sideA`/`sideB` so the
 * ballot can wash the whole screen in a side's color without introducing a new opaque token.
 */
export const glows = {
  sideA: 'rgba(59,130,246,0.42)',
  sideB: 'rgba(249,115,22,0.42)',
} as const;

/**
 * SW0-T2: the single source of the swipe/reveal motion durations (ms). The CSS keyframes in
 * `apps/web/app/globals.css` and the JS timers in `SwipeBallot` (SW1-T2) both read these via
 * the Tailwind `transitionDuration`/`animationDuration` extension so a re-timed animation
 * changes in one place. The reveal-sequence beats keep their own long-standing constants in
 * `RevealSequence`; these are the interaction-layer additions.
 */
export const motion = {
  armFlare: 120,
  fling: 300,
  snap: 400,
  print: 420,
  stamp: 450,
} as const;

/** SW0-T2: the two card shadows that make paper float on the dark stage (deck) and the
 * receipt lift off the bottom edge (print). Kept beside the tokens so the ballot and any OG
 * template share one definition. */
export const cardShades = {
  deckShadow: '0 14px 34px rgba(0,0,0,0.5)',
  printShadow: '0 -10px 30px rgba(0,0,0,0.5)',
} as const;

export const fonts = {
  ui: 'Inter, system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  /**
   * SW0-T2 (D-SW2): Barlow Condensed for question headlines, stamps, and display chrome —
   * ticket-window / fight-poster DNA. The webfont is loaded via `next/font` in the web app
   * (`apps/web/app/layout.tsx`) and exposed to Tailwind as the leading `--font-display`
   * variable; this stack is the fallback tail. Numerals stay `mono`, body stays `ui`.
   */
  display: '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif',
} as const;

export type ColorToken = keyof typeof colors;
export type FontToken = keyof typeof fonts;
export type GlowToken = keyof typeof glows;
export type MotionToken = keyof typeof motion;
