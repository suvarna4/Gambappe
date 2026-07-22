/**
 * WS18-T3 · The stack deck queue reducer (journeys plan §5, D-J2). Node-testable (pure) coverage
 * of the throw/skip/order/enqueue rules — the browser-driven deck itself is exercised by
 * `e2e/stack-deck.spec.ts`. The load-bearing invariant here: a SKIP re-enqueues at the back and
 * NEVER marks a pick (never appends to `thrown`), so it can never reach the pick API.
 */
import { describe, expect, it } from 'vitest';
import {
  currentCardId,
  deckCleared,
  deckPosition,
  deckQueueReducer,
  initialDeckState,
  type DeckQueueState,
} from '@/lib/deck-queue';

const CARDS = ['headliner', 'topic-a', 'topic-b'];
const fresh = (): DeckQueueState => initialDeckState(CARDS);

describe('initialDeckState', () => {
  it('deals the cards in order with nothing thrown or skipped', () => {
    const s = fresh();
    expect(s.order).toEqual(CARDS);
    expect(s.thrown).toEqual([]);
    expect(s.skips).toBe(0);
    expect(currentCardId(s)).toBe('headliner');
    expect(deckCleared(s)).toBe(false);
  });

  it('copies the input array (mutating the source never mutates state)', () => {
    const src = [...CARDS];
    const s = initialDeckState(src);
    src.push('injected');
    expect(s.order).toEqual(CARDS);
  });
});

describe('throw', () => {
  it('removes the front card and records it in `thrown`', () => {
    const s = deckQueueReducer(fresh(), { type: 'throw', id: 'headliner' });
    expect(s.order).toEqual(['topic-a', 'topic-b']);
    expect(s.thrown).toEqual(['headliner']);
    expect(s.skips).toBe(0);
    expect(currentCardId(s)).toBe('topic-a');
  });

  it('throwing every card clears the deck and records all throws', () => {
    let s = fresh();
    s = deckQueueReducer(s, { type: 'throw', id: 'headliner' });
    s = deckQueueReducer(s, { type: 'throw', id: 'topic-a' });
    s = deckQueueReducer(s, { type: 'throw', id: 'topic-b' });
    expect(deckCleared(s)).toBe(true);
    expect(currentCardId(s)).toBeNull();
    expect(s.thrown).toEqual(['headliner', 'topic-a', 'topic-b']);
    expect(s.skips).toBe(0);
  });
});

describe('skip', () => {
  it('re-enqueues the front card at the BACK and never marks it a pick', () => {
    const s = deckQueueReducer(fresh(), { type: 'skip', id: 'headliner' });
    // Same cards, headliner moved to the back — order length is unchanged (nothing left the deck).
    expect(s.order).toEqual(['topic-a', 'topic-b', 'headliner']);
    expect(s.order).toHaveLength(CARDS.length);
    expect(currentCardId(s)).toBe('topic-a');
    // The pick invariant: a skip produces NO thrown entry (so it can never hit the pick API).
    expect(s.thrown).toEqual([]);
    expect(s.skips).toBe(1);
  });

  it('a skipped headliner resurfaces at the back (comes back before lock)', () => {
    let s = fresh();
    s = deckQueueReducer(s, { type: 'skip', id: 'headliner' });
    s = deckQueueReducer(s, { type: 'skip', id: 'topic-a' });
    s = deckQueueReducer(s, { type: 'skip', id: 'topic-b' });
    // After skipping all three, the headliner is back on top — the deck never runs dry via skips.
    expect(currentCardId(s)).toBe('headliner');
    expect(s.order).toEqual(['headliner', 'topic-a', 'topic-b']);
    expect(deckCleared(s)).toBe(false);
    expect(s.thrown).toEqual([]);
    expect(s.skips).toBe(3);
  });

  it('no amount of skipping ever marks a pick', () => {
    let s = fresh();
    for (let i = 0; i < 20; i += 1) {
      s = deckQueueReducer(s, { type: 'skip', id: currentCardId(s)! });
    }
    expect(s.thrown).toEqual([]);
    expect(deckCleared(s)).toBe(false);
    expect(s.skips).toBe(20);
  });

  it('a card can be thrown after having been skipped earlier', () => {
    let s = fresh();
    s = deckQueueReducer(s, { type: 'skip', id: 'headliner' }); // headliner -> back
    // now topic-a, topic-b, headliner
    s = deckQueueReducer(s, { type: 'throw', id: 'topic-a' });
    s = deckQueueReducer(s, { type: 'throw', id: 'topic-b' });
    s = deckQueueReducer(s, { type: 'throw', id: 'headliner' });
    expect(deckCleared(s)).toBe(true);
    expect(s.thrown).toEqual(['topic-a', 'topic-b', 'headliner']);
    expect(s.skips).toBe(1);
  });
});

describe('idempotency guard', () => {
  it('an action for a card that is not on stage is a no-op', () => {
    const s0 = fresh();
    const sameThrow = deckQueueReducer(s0, { type: 'throw', id: 'topic-b' });
    const sameSkip = deckQueueReducer(s0, { type: 'skip', id: 'topic-b' });
    expect(sameThrow).toBe(s0);
    expect(sameSkip).toBe(s0);
  });

  it('an action against an empty deck is a no-op', () => {
    const empty: DeckQueueState = { order: [], thrown: ['x'], skips: 0 };
    expect(deckQueueReducer(empty, { type: 'throw', id: 'x' })).toBe(empty);
  });
});

describe('reset (topic filter re-deal)', () => {
  it('replaces the deck with the new card set and clears thrown/skips', () => {
    let s = fresh();
    s = deckQueueReducer(s, { type: 'throw', id: 'headliner' });
    s = deckQueueReducer(s, { type: 'skip', id: 'topic-a' });
    const next = deckQueueReducer(s, { type: 'reset', ids: ['x', 'y'] });
    expect(next.order).toEqual(['x', 'y']);
    expect(next.thrown).toEqual([]);
    expect(next.skips).toBe(0);
    expect(currentCardId(next)).toBe('x');
    expect(deckCleared(next)).toBe(false);
  });

  it('resets to an empty (cleared) deck when the new set is empty', () => {
    const next = deckQueueReducer(fresh(), { type: 'reset', ids: [] });
    expect(next.order).toEqual([]);
    expect(deckCleared(next)).toBe(true);
  });

  it('makes a stale throw/skip for the OLD front card a no-op after re-deal', () => {
    const s = deckQueueReducer(fresh(), { type: 'reset', ids: ['x', 'y'] });
    // 'headliner' was the old front; a late fling/skip callback for it must not touch the new deck.
    expect(deckQueueReducer(s, { type: 'throw', id: 'headliner' })).toBe(s);
    expect(deckQueueReducer(s, { type: 'skip', id: 'headliner' })).toBe(s);
  });
});

describe('deckPosition (the "N of M" progress chip)', () => {
  it('starts at 1 of M and advances only on throws, not skips', () => {
    let s = fresh();
    expect(deckPosition(s, CARDS.length)).toBe(1);
    s = deckQueueReducer(s, { type: 'skip', id: 'headliner' });
    expect(deckPosition(s, CARDS.length)).toBe(1); // skip did not advance the count
    s = deckQueueReducer(s, { type: 'throw', id: 'topic-a' });
    expect(deckPosition(s, CARDS.length)).toBe(2);
  });

  it('reads M of M once the deck is cleared', () => {
    let s = fresh();
    for (const id of CARDS) s = deckQueueReducer(s, { type: 'throw', id });
    expect(deckPosition(s, CARDS.length)).toBe(CARDS.length);
  });
});
