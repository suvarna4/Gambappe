/**
 * `/` — today's question (design doc §10.1: "SSR + client hydrate | today's question | State
 * machine UI (§10.3)"). WS7-T2.
 */
import type { Metadata } from 'next';
import { nowMs, PRODUCT_NAME } from '@receipts/core';
import { QuestionStateView } from '@/components/QuestionStateView';
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

export default async function HomePage() {
  const nowMsValue = nowMs();
  const question = await getTodayQuestionPublic(getDb(), { nowMsValue });
  const serverOffsetMs = nowMsValue - Date.now();

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-bold">{PRODUCT_NAME}</h1>
      {question ? (
        <QuestionStateView
          question={question}
          serverOffsetMs={serverOffsetMs}
          viewerSlot={<ViewerStrip question={question} />}
        />
      ) : (
        <p className="text-muted text-sm" data-testid="no-question-today">
          {copy.question.noQuestionToday}
        </p>
      )}
    </main>
  );
}
