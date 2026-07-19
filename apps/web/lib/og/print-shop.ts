/**
 * SW4-T2 · The "Print Shop" palette for share cards / OG images (swipe-ux-plan §2.1, D-SW1).
 * All OG/card output is the light paper-and-rubber-stamp face — a card pasted into a daylight
 * chat must read, so the artifacts are a different paper stock from the dark in-app world. Lives
 * beside the OG templates (not in `@receipts/ui` tokens) because it is a card stock, not an app
 * theme. Side colors are the darkened on-paper inks (AA on cream).
 */
export const printShop = {
  ground: '#EFEBDD',
  paper: '#FBF9F1',
  ink: '#1A1A1A',
  muted: '#6D6A61',
  sideA: '#2456C9',
  sideB: '#D64B12',
  win: '#1D8A6B',
  loss: '#C22B49',
  gold: '#B8860B',
} as const;

/** Satori font-family names — must match the `name`s registered in `loadDisplayFonts` (fonts.ts). */
export const CARD_DISPLAY_FONT = 'Barlow Condensed';
export const CARD_MONO_FONT = 'IBM Plex Mono';
