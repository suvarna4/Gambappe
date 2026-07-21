/**
 * `/` — today's question (design doc §10.1: "SSR + client hydrate | today's question | State
 * machine UI (§10.3)"). WS7-T2.
 */
import type { Metadata } from 'next';
import { isFlagEnabled, nowMs, PRODUCT_NAME } from '@receipts/core';
import { QuestionStateView } from '@/components/QuestionStateView';
import { StreakBadge } from '@/components/StreakBadge';
import { ViewerStrip } from '@/components/ViewerStrip';
import { copy } from '@/lib/copy';
import { getTodayQuestionPublic } from '@/lib/question-view';
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
  // SW2-T4: pre-armed deep link (notification/unfurl). `arm` is not viewer data (a URL param),
  // so it doesn't affect INV-10; the client strips it after mount (SW7-T2).
  const arm = swipeBallot && (await searchParams).arm === '1';

  const content = question ? (
    <QuestionStateView
      question={question}
      serverOffsetMs={serverOffsetMs}
      swipeBallot={swipeBallot}
      streakSlot={swipeBallot ? <StreakBadge /> : undefined}
      viewerSlot={
        <ViewerStrip question={question} swipeBallot={swipeBallot} arm={arm} duoQueue={duoQueue} />
      }
    />
  ) : (
    <p
      className={swipeBallot ? 'text-muted p-6 text-sm' : 'text-muted text-sm'}
      data-testid="no-question-today"
    >
      {copy.question.noQuestionToday}
    </p>
  );

  // Design-diff audit: the mockup's own lede for this primitive is explicit — "the swipe ballot
  // is not a control on a page — it IS the page" (`docs/mockups/swipe-ux.html`'s "01 THE
  // PRIMITIVE"). The flag-off ticket layout keeps its own page shell (title + margins) exactly
  // as before (INV-10 byte-identical); the flag-on deck bleeds edge-to-edge instead — no page
  // title competing with the deck's own topbar (`DeckTopbar`, threaded above) for the same
  // "TODAY" chrome, no page-shell margin duplicating the deck's own internal insets.
  if (swipeBallot) {
    return <main className="flex flex-1 flex-col">{content}</main>;
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-bold">{PRODUCT_NAME}</h1>
      {content}
    </main>
  );
}
