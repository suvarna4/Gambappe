/**
 * SW0-T2 · The side-axis rule (swipe-ux-plan §2.2, decision D-SW9).
 *
 * In every horizontally paired yes/no UI, the **NO / against element sits on the LEFT and
 * the YES / for element on the RIGHT** — so the swipe gesture (left = against, right = for)
 * and the button/label pair always agree. "Left" and "right" here are *visual* positions in
 * physical gesture space, not logical/reading order: axis rows set `dir="ltr"` so an RTL
 * locale never mirrors the gesture semantics.
 *
 * Render axis pairs by mapping over `SIDE_ORDER` or building them with `sideAxisPair` rather
 * than hand-writing `['yes', 'no']` — reviewers treat a hand-ordered axis pair as a
 * correctness bug, and `side-axis.test.ts` + the JSX lint (SW2-T3) enforce it.
 *
 * This does NOT apply to person-axis pairs (you vs. nemesis, partner vs. partner) — those are
 * not yes/no pairs — nor to single-valued win/loss result displays.
 */
import type { MarketSide } from './format.js';

/** Visual left-to-right order for a yes/no axis: against first, for second. */
export const SIDE_ORDER = ['no', 'yes'] as const satisfies readonly MarketSide[];

/**
 * Order a value for each side into `[no, yes]` — i.e. left-to-right on the axis. Pass the
 * NO/against value first and the YES/for value second (named parameters, so a call site can't
 * silently transpose them), and render the returned tuple in array order.
 *
 * @example
 *   const [left, right] = sideAxisPair(noButton, yesButton);
 *   return <div dir="ltr" className="flex">{left}{right}</div>;
 */
export function sideAxisPair<T>(no: T, yes: T): [T, T] {
  return [no, yes];
}

/**
 * Map a side to its position on the axis (`0` = left/no, `1` = right/yes). Handy for
 * ordering, `flex-direction`, or asserting DOM order in tests.
 */
export function sideAxisIndex(side: MarketSide): 0 | 1 {
  return side === 'no' ? 0 : 1;
}
