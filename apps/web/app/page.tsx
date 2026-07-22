/**
 * `/` — today's question (design doc §10.1: "SSR + client hydrate | today's question | State
 * machine UI (§10.3)"). WS7-T2.
 */
import type { Metadata } from 'next';
import { isFlagEnabled, nowMs, PRODUCT_NAME } from '@receipts/core';
import { QuestionStateView } from '@/components/QuestionStateView';
import { DeckStageBridge } from '@/components/shell/DeckStageBridge';
import { StackDeck } from '@/components/StackDeck';
import { ViewerStrip } from '@/components/ViewerStrip';
import { copy } from '@/lib/copy';
import { getTodayQuestionPublic } from '@/lib/question-view';
import { assembleStackFeed } from '@/lib/stack-feed';
import { getDb } from '@/lib/stores';

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — today’s question`,
  description: 'Pick a side on today’s real prediction-market question. No money, just receipts.',
};

// Re-evaluated per request (today's question changes daily and needs the effective-status
// timestamp math to stay live) — WS8-T3 owns the CDN/ISR layer proper (§10.2), this task only
// needs the render to be correct and viewer-free (INV-10).
export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ arm?: string }>;
}) {
  const nowMsValue = nowMs();
  const question = await getTodayQuestionPublic(getDb(), { nowMsValue });
  const serverOffsetMs = nowMsValue - Date.now();
  // SW1-T4/SW2-T1: flag read server-side (never viewer data) and threaded to both the shell and
  // the viewer island; off → today's flow renders byte-identically (INV-10).
  const swipeBallot = isFlagEnabled('swipe_ballot');
  // SW10-T3(a): same server-side, non-viewer flag posture as `swipeBallot` above — gates whether
  // `ViewerStrip` bothers fetching the viewer's active duo for the sealed partner chip.
  const duoQueue = isFlagEnabled('duo_queue');
  // WS18-T3 (D-J2): the topic supply flag. The mixed stack deck needs both this AND `swipe_ballot`
  // (it is built on the swipe deck). `stack-feed.ts` already forces `topics: []` when this is off.
  const topicMarkets = isFlagEnabled('topic_markets');
  // SW2-T4: pre-armed deep link (notification/unfurl). `arm` is not viewer data (a URL param),
  // so it doesn't affect INV-10; the client strips it after mount (SW7-T2).
  const arm = swipeBallot && (await searchParams).arm === '1';

  // WS18-T3 (D-J2, seam 6): the single mixed stack deck on `/`. It replaces the single-question
  // render ONLY when both `swipe_ballot` and `topic_markets` are on. With `topic_markets` off the
  // condition is false and control falls through to the untouched single-question path below —
  // that is the "flag off ⇒ `/` byte-identical to today" guarantee (asserted in
  // `e2e/stack-deck.spec.ts`). The feed is assembled viewer-free (INV-10: no `viewerProfileId`, so
  // the ghost/all-categories default is used and `/`'s HTML is identical for every visitor);
  // `DeckQueue` owns `deckOnStage` itself (D-J6), so there is no `DeckStageBridge` on this path.
  if (swipeBallot && topicMarkets) {
    const feed = await assembleStackFeed(getDb(), { nowMsValue });
    return (
      <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
        <h1 className="text-2xl font-bold">{PRODUCT_NAME}</h1>
        <StackDeck feed={feed} serverOffsetMs={serverOffsetMs} arm={arm} duoQueue={duoQueue} />
      </main>
    );
  }

  // D-J6/WS17-T1: while today's question is on the full-screen deck (swipe_ballot on + open
  // state), sink the bottom tab bar (D-SW4 ritual). `DeckStageBridge` renders no DOM and its
  // `active` flag is flag/status-derived (not viewer data), so `/`'s HTML stays viewer-free
  // (INV-10). Off-flag or any non-open state → bar stays put.
  const deckOnStage = swipeBallot && question?.status === 'open';

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <DeckStageBridge active={deckOnStage} />
      <h1 className="text-2xl font-bold">{PRODUCT_NAME}</h1>
      {question ? (
        <QuestionStateView
          question={question}
          serverOffsetMs={serverOffsetMs}
          swipeBallot={swipeBallot}
          viewerSlot={
            <ViewerStrip
              question={question}
              swipeBallot={swipeBallot}
              arm={arm}
              duoQueue={duoQueue}
            />
          }
        />
      ) : (
        <p className="text-muted text-sm" data-testid="no-question-today">
          {copy.question.noQuestionToday}
        </p>
      )}
    </main>
  );
}
