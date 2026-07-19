/**
 * The side-axis rule (D-SW9, `docs/swipe-ux-plan.md` §2.2 — normative): in every horizontally
 * paired yes/no UI, the NO/against element occupies the LEFT position and the YES/for element
 * the RIGHT position — everywhere, always. "Left/right" are VISUAL (physical gesture space,
 * matching swipe-left = against), not logical/RTL order — any container laying out an axis
 * pair must set `dir="ltr"` so RTL locales don't mirror the gesture semantics.
 *
 * Components must render axis pairs by mapping over `SIDE_ORDER` or through `sideAxisPair`,
 * never by hand-ordering the two sides (a hand-ordered pair is a correctness bug, enforced by
 * `scripts/check-side-axis.mjs`). Unit tests assert DOM order via `data-side` attributes: the
 * first axis child always carries `data-side="no"`.
 *
 * Does NOT apply to person-axis pairs (you vs. nemesis, partner vs. partner) — those are not
 * yes/no pairs. Win/loss result displays are single-valued, not pairs.
 */
/** Visual left→right order for every yes/no axis pair: NO left, YES right (D-SW9). */
export const SIDE_ORDER = ['no', 'yes'] as const;

/** Orders an axis pair's two values left→right per D-SW9: `[no, yes]`. */
export function sideAxisPair<T>(no: T, yes: T): [T, T] {
  return [no, yes];
}
