/**
 * WS18-T3 · The stack deck's queue logic as a PURE reducer (journeys plan §5, D-J2), extracted so
 * the enqueue/skip/throw rules are node-testable with no browser (the component owns the DOM,
 * animation, and the pick/skip wiring; this owns only the ordering). The rules:
 *
 *  - `throw` (the viewer picked a side): the front card leaves the deck and is recorded in
 *    `thrown` so the cleared state can count it.
 *  - `skip` (up-swipe / `ArrowUp` / `S`): the front card re-enqueues at the BACK and `skips`
 *    increments. A skip is "not now", NEVER a pick — it produces no `thrown` entry and the
 *    component never routes it to the pick API. That guarantee is asserted directly in
 *    `test/deck-queue.test.ts`.
 *
 * Both actions carry the card `id` and are idempotent no-ops unless that id is the card currently
 * on stage (`order[0]`), so a late fling/skip animation callback that resolves after the deck has
 * already advanced can't throw or skip the wrong card.
 */

export interface DeckCard {
  id: string;
  /** The daily headliner (carries the streak + rival chip); topic cards are `false`. */
  isHeadliner: boolean;
}

export interface DeckQueueState {
  /** Remaining card ids in deal order; index 0 is the card currently on stage. */
  order: string[];
  /** Ids thrown (a pick was committed), in throw order. Skips NEVER appear here. */
  thrown: string[];
  /** Total skip actions taken (a card may be skipped more than once as it recirculates). */
  skips: number;
}

export type DeckQueueAction =
  | { type: 'throw'; id: string }
  | { type: 'skip'; id: string }
  // WS-home-filter: re-deal the whole deck from a fresh card set (the topic filter refetched
  // `GET /api/v1/stack`). Resets `thrown`/`skips` so the "N of M" progress recomputes against the
  // new total. Carries no `id`, so it bypasses the front-of-deck idempotency guard below.
  | { type: 'reset'; ids: string[] };

export function initialDeckState(cardIds: string[]): DeckQueueState {
  return { order: [...cardIds], thrown: [], skips: 0 };
}

/** The card currently on stage, or `null` once the deck is cleared. */
export function currentCardId(state: DeckQueueState): string | null {
  return state.order[0] ?? null;
}

/** True once every card has been thrown (skips re-enqueue, so they never empty the deck). */
export function deckCleared(state: DeckQueueState): boolean {
  return state.order.length === 0;
}

/**
 * 1-indexed position among the `total` dealt cards for the "N of M" progress chip: the number
 * thrown so far, plus the one on stage (0 once cleared, so it reads `M of M`). Clamped to `total`.
 */
export function deckPosition(state: DeckQueueState, total: number): number {
  return Math.min(total, state.thrown.length + (deckCleared(state) ? 0 : 1));
}

export function deckQueueReducer(
  state: DeckQueueState,
  action: DeckQueueAction,
): DeckQueueState {
  // Re-deal from a fresh card set (topic filter change). No front guard: it replaces the deck.
  if (action.type === 'reset') return initialDeckState(action.ids);

  const front = state.order[0];
  // Idempotency guard: only the card actually on stage can be thrown or skipped.
  if (front === undefined || front !== action.id) return state;
  const rest = state.order.slice(1);
  switch (action.type) {
    case 'throw':
      // Thrown card leaves the deck; recorded so the cleared state can count it. No re-enqueue.
      return { ...state, order: rest, thrown: [...state.thrown, front] };
    case 'skip':
      // Skip = "not now": card goes to the BACK, `skips` increments, and it is NEVER marked as a
      // pick (no pick API, no `thrown` entry). The deck just keeps dealing.
      return { ...state, order: [...rest, front], skips: state.skips + 1 };
    default:
      return state;
  }
}
