/**
 * Small pure formatters shared by the profile record surfaces (`/p/[slug]` and `/you`, WS22-T1).
 * Extracted from `app/p/[slug]/page.tsx` so the public profile page and the signed-in `/you`
 * record room render the exact same stat text (journeys plan §5 WS22-T1: "reuse the `/p/[slug]`
 * components — no forked stat markup"). `/p/[slug]`'s `generateMetadata` keeps importing
 * `topPercentDisplay` from here, so the og:description convention stays a single source.
 */

/** §8.6 display convention: "Top X%" where X = 100 − percentile, min display "Top 1%". */
export function topPercentDisplay(percentile: number): string {
  return `Top ${Math.max(1, Math.round(100 - percentile))}%`;
}
