/**
 * `/q/[slug]` — the spectator question page (design doc §10.1: "ISR (revalidate 30s +
 * on-demand) | question public shape | The spectator page (INV-10). Viewer-specific strip
 * hydrates client-side only"). WS7-T2.
 *
 * On-demand revalidation via `POST /internal/revalidate` (§9.2) and the CDN cache-key-ignores-
 * cookies hardening (§10.2/WS8-T3) are WS8-T3 scope, not this task's — this page just needs to
 * render correctly and stay viewer-free so that layer can do its job once it lands.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { nowMs } from '@receipts/core';
import { QuestionStateView } from '@/components/QuestionStateView';
import { ViewerStrip } from '@/components/ViewerStrip';
import { describeQuestionState } from '@/lib/question-meta';
import { getQuestionPublicBySlug } from '@/lib/question-view';
import { getDb } from '@/lib/stores';

export const revalidate = 30;

interface QuestionPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: QuestionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const question = await getQuestionPublicBySlug(getDb(), slug);
  if (!question) return {};

  const description = describeQuestionState(question);
  return {
    title: `${question.headline} — Receipts`,
    description,
    openGraph: { title: question.headline, description, type: 'website' },
    twitter: { card: 'summary_large_image', title: question.headline, description },
    // SPEC-GAP(WS7-T2): og:image intentionally omitted here — the real URL is WS8-T1's
    // content-addressed `/api/og/question?...v=<state hash>` scheme (§10.5), which isn't built
    // yet; a guessed shape would just be wrong once WS8 ships and starts serving that route.
    alternates: {
      // §10.5: oEmbed discovery link on all public pages (the endpoint itself is WS8-T4).
      types: { 'application/json+oembed': `/api/oembed?url=/q/${question.slug}` },
    },
  };
}

export default async function QuestionPage({ params }: QuestionPageProps) {
  const { slug } = await params;
  const nowMsValue = nowMs();
  const question = await getQuestionPublicBySlug(getDb(), slug, { nowMsValue });
  if (!question) notFound();

  const serverOffsetMs = nowMsValue - Date.now();

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <QuestionStateView
        question={question}
        serverOffsetMs={serverOffsetMs}
        viewerSlot={<ViewerStrip question={question} />}
      />
    </main>
  );
}
