/**
 * §10.3/§10.4 "fully honoring `prefers-reduced-motion`" (the reveal moment is the product's
 * only motion budget, PRD §8). A plain function, not a hook — call sites read it once (e.g. a
 * lazy `useState` initializer) rather than re-rendering live if the OS setting flips mid-session,
 * which no animation here needs to react to. SSR-safe: `window`/`matchMedia` are absent
 * server-side, so this deterministically returns `false` there (never actually reached mid-render
 * since every consumer only calls this from a client-only effect/initializer).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
