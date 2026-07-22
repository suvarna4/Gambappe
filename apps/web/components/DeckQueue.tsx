'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { StackFeed, StackQuestion } from '@receipts/core';
import { Stamp } from '@receipts/ui';
import { copy, stackCopy } from '@/lib/copy';
import {
  currentCardId,
  deckCleared,
  deckPosition,
  deckQueueReducer,
  initialDeckState,
  type DeckCard,
} from '@/lib/deck-queue';
import { useSetDeckOnStage } from '@/lib/shell-context';
import { QuestionStateView } from './QuestionStateView';
import { ViewerStrip } from './ViewerStrip';

export interface DeckQueueProps {
  /** The stack feed assembled server-side (`lib/stack-feed.ts`): headliner + open topic cards. */
  feed: StackFeed;
  /** `serverNow - Date.now()` at render (threaded to each card's `QuestionStateView`). */
  serverOffsetMs: number;
  /** SW2-T4 deep-link nudge — applies to the headliner only (today's daily). */
  arm?: boolean;
  /** SW10-T3(a) `duo_queue` flag, forwarded to each card's `ViewerStrip`. */
  duoQueue?: boolean;
  /**
   * The active nemesis's handle, for the headliner's `⚔ {handle} IS IN · SEALED` chip. Viewer
   * data, so the SSR `/` render passes `null` (INV-10); the chip only lights when a handle AND the
   * card's `rival_sealed` are both present (both are wired later — the feed emits `rival_sealed:
   * null` for now, so the chip stays dormant, per the journeys plan's `.nullish()` note).
   */
  rivalHandle?: string | null;
}

/**
 * WS18-T3 · The single mixed stack deck on `/` (journeys plan §5, D-J2): today's headliner first,
 * then open topic-market cards. Right = yes, left = no, up = SKIP (the card returns to the back).
 * The queue math is the pure `deckQueueReducer` (`lib/deck-queue.ts`, unit-tested); this component
 * owns the wiring: it deals one card at a time through the EXISTING `QuestionStateView` +
 * `ViewerStrip` + `SwipeBallot` path (no fork — `SwipeBallot` gained only `onSkip`/`footerSlot`,
 * seam 3), advancing on a throw (a committed pick) and re-enqueuing on a skip. A skip never reaches
 * the pick API (see the reducer + `SwipeBallot.triggerSkip`). While an open card is centered it
 * raises the deck onto the shell stage so the tab bar sinks (D-J6, `useSetDeckOnStage`).
 */
export function DeckQueue({
  feed,
  serverOffsetMs,
  arm = false,
  duoQueue = false,
  rivalHandle = null,
}: DeckQueueProps) {
  const cards = useMemo<DeckCard[]>(() => buildCards(feed), [feed]);
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c] as const)), [cards]);
  const questionsById = useMemo(() => buildQuestionMap(feed), [feed]);

  const [state, dispatch] = useReducer(
    deckQueueReducer,
    cards,
    (c) => initialDeckState(c.map((card) => card.id)),
  );

  const headlinerId = feed.headliner?.id ?? null;
  // Shows the "comes back before lock" reassurance while a skipped headliner is off-stage but
  // still circulating in the deck (D-J2 AC: headliner skip resurfaces before lock).
  const [headlinerSkipped, setHeadlinerSkipped] = useState(false);

  // Re-deal when a NEW feed arrives post-hydration (the home topic filter refetched the stack).
  // The reducer only inits once, so a fresh feed needs an explicit `reset`. Skip the first run so
  // the SSR feed (already seeded above) isn't re-dealt — that would also break INV-10's first paint.
  const cardIdsKey = useMemo(() => cards.map((c) => c.id).join(','), [cards]);
  const firstFeed = useRef(true);
  useEffect(() => {
    if (firstFeed.current) {
      firstFeed.current = false;
      return;
    }
    dispatch({ type: 'reset', ids: cardIdsKey ? cardIdsKey.split(',') : [] });
    setHeadlinerSkipped(false);
  }, [cardIdsKey]);

  const currentId = currentCardId(state);
  const current = currentId ? (cardsById.get(currentId) ?? null) : null;
  const currentQuestion = currentId ? (questionsById.get(currentId) ?? null) : null;
  const cleared = deckCleared(state);
  const total = cards.length;

  // D-J6: raise the deck onto the shell stage (sink the tab bar) only while an OPEN card is
  // centered full-screen; drop it on the cleared/non-open state and on unmount.
  const setDeckOnStage = useSetDeckOnStage();
  const onStage = !cleared && currentQuestion?.status === 'open';
  useEffect(() => {
    setDeckOnStage(Boolean(onStage));
    return () => setDeckOnStage(false);
  }, [onStage, setDeckOnStage]);

  const skip = (id: string) => {
    if (id === headlinerId) setHeadlinerSkipped(true);
    dispatch({ type: 'skip', id });
  };
  const throwCard = (id: string) => dispatch({ type: 'throw', id });

  // Empty feed (no daily drop yet, no topics) — mirror the single-question page's empty message
  // rather than showing a "Stack cleared" celebration for a deck that never had cards.
  if (total === 0) {
    return (
      <p className="text-muted text-sm" data-testid="no-question-today">
        {copy.question.noQuestionToday}
      </p>
    );
  }

  if (cleared || !current || !currentQuestion) {
    return <DeckClearedState thrown={state.thrown.length} skipped={state.skips} />;
  }

  const pos = deckPosition(state, total);
  const headlinerParked =
    headlinerSkipped && headlinerId !== null && currentId !== headlinerId;

  const footer = current.isHeadliner ? (
    <DeckHeadlinerFooter rivalSealed={currentQuestion.rival_sealed} rivalHandle={rivalHandle} />
  ) : null;

  return (
    <div className="space-y-4" data-testid="deck-queue">
      <div className="flex items-center justify-between">
        <span
          data-testid="deck-progress"
          className="text-muted font-mono text-xs tracking-widest uppercase"
        >
          {stackCopy.progress(pos, total)}
        </span>
        {headlinerParked ? (
          <span data-testid="deck-skip-caveat" className="text-muted text-xs">
            {stackCopy.headlinerSkipCaveat}
          </span>
        ) : null}
      </div>

      {/* Keyed by card id so each card's `ViewerStrip` (pick cache, `/me` fetch, swipe state)
          mounts fresh as the deck advances — no state bleeds between cards. */}
      <div key={current.id}>
        <QuestionStateView
          question={currentQuestion}
          serverOffsetMs={serverOffsetMs}
          swipeBallot
          viewerSlot={
            <ViewerStrip
              question={currentQuestion}
              swipeBallot
              arm={current.isHeadliner ? arm : false}
              duoQueue={duoQueue}
              onSkip={() => skip(current.id)}
              onPicked={() => throwCard(current.id)}
              footerSlot={footer}
            />
          }
        />
      </div>
    </div>
  );
}

/** Cards in deal order: headliner first (if present), then the open topic cards. */
function buildCards(feed: StackFeed): DeckCard[] {
  const list: DeckCard[] = [];
  if (feed.headliner) list.push({ id: feed.headliner.id, isHeadliner: true });
  for (const topic of feed.topics) list.push({ id: topic.id, isHeadliner: false });
  return list;
}

function buildQuestionMap(feed: StackFeed): Map<string, StackQuestion> {
  const map = new Map<string, StackQuestion>();
  if (feed.headliner) map.set(feed.headliner.id, feed.headliner);
  for (const topic of feed.topics) map.set(topic.id, topic);
  return map;
}

/**
 * The headliner-only footer (D-J2: "only the headliner carries the streak"). `STREAK RIDES THIS`
 * always; the rival chip only when the viewer's active nemesis has a SEALED pick on this shared
 * question (`rival_sealed`) and a handle is known. Exported for unit coverage.
 */
export function DeckHeadlinerFooter({
  rivalSealed,
  rivalHandle,
}: {
  rivalSealed?: boolean | null;
  rivalHandle?: string | null;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="deck-headliner-footer">
      <span className="border-win text-win rounded border px-2 py-0.5 font-mono text-[11px] font-bold tracking-widest uppercase">
        {stackCopy.streakRides}
      </span>
      {rivalSealed && rivalHandle ? (
        <span
          data-testid="deck-rival-chip"
          className="border-ink/40 text-ink/80 rounded border px-2 py-0.5 font-mono text-[11px] tracking-widest uppercase"
        >
          {stackCopy.rivalSealed(rivalHandle)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * End-of-stack state (D-J2): a foil moment + the run's thrown/skipped tally + the link to `/sweat`.
 * WS19-T2's `SweatRow` isn't merged yet, so per the task we render the link only (the top-3 sweat
 * rows land when that component exists).
 */
function DeckClearedState({ thrown, skipped }: { thrown: number; skipped: number }): ReactNode {
  return (
    <div className="space-y-3 text-center" data-testid="deck-cleared">
      {/* The only foil in the product is the sanctioned `called_it` stamp (D-SW1 scarcity, grep-
          gated in `stamp-ink.test.tsx`); the pinned "Stack cleared" words sit alongside it. */}
      <div className="flex justify-center">
        <Stamp variant="called_it" animated />
      </div>
      <h2 className="font-display text-2xl font-bold uppercase">{stackCopy.clearedTitle}</h2>
      <p className="text-muted font-mono text-xs tracking-widest uppercase">
        {stackCopy.clearedThrown(thrown)} · {stackCopy.clearedSkipped(skipped)}
      </p>
      <p className="text-muted text-sm">{stackCopy.clearedBlurb}</p>
      <p>
        <a
          href="/sweat"
          data-testid="deck-sweat-link"
          className="text-side-a text-sm font-semibold underline"
        >
          {stackCopy.sweatLink}
        </a>
      </p>
    </div>
  );
}
