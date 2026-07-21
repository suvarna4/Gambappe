/**
 * `/q/[slug]` — the spectator question page (design doc §10.1: "ISR (revalidate 30s +
 * on-demand) | question public shape | The spectator page (INV-10). Viewer-specific strip
 * hydrates client-side only"). WS7-T2 owns the state-machine UI; WS8-T1/T3 (this PR) add the
 * real `og:image` (content-addressed `/api/og/question` URL, §10.5) and on-demand revalidation
 * via `POST /internal/revalidate` (§9.2) — reconciled from independent scaffolds on rebase.
 *
 * Next.js statically extracts route segment config via AST analysis at build time — `revalidate`
 * must be a literal, not an imported identifier (importing `ISR_REVALIDATE_QUESTION_S` here fails
 * the build with "Unknown identifier ... at revalidate"). The literal is pinned back to
 * `@receipts/core`'s single source of truth by `test/integration/spectator-question-page.test.ts`,
 * which asserts this equals `ISR_REVALIDATE_QUESTION_S` at runtime — keep the two in sync by hand
 * if Appendix D changes.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isFlagEnabled, nowMs, PRODUCT_NAME } from '@receipts/core';
import { QuestionStateView } from '@/components/QuestionStateView';
import { StreakBadge } from '@/components/StreakBadge';
import { ViewerStrip } from '@/components/ViewerStrip';
import { appUrl } from '@/lib/app-url';
import { describeQuestionState } from '@/lib/question-meta';
import { getQuestionPublicBySlug } from '@/lib/question-view';
import { loadQuestionOg } from '@/lib/og/entities';
import { buildQuestionJsonLd } from '@/lib/structured-data';
import { getDb } from '@/lib/stores';

export const revalidate = 30; // ISR_REVALIDATE_QUESTION_S (design doc §10.1 route table)

interface QuestionPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: QuestionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const question = await getQuestionPublicBySlug(getDb(), slug);
  if (!question) return {};

  const description = describeQuestionState(question);
  const og = await loadQuestionOg(getDb(), slug);
  const ogImage = og ? `/api/og/question/${encodeURIComponent(slug)}?v=${og.hash}` : undefined;
  const pageUrl = `${appUrl()}/q/${question.slug}`;

  return {
    title: `${question.headline} — ${PRODUCT_NAME}`,
    description,
    openGraph: {
      title: question.headline,
      description,
      type: 'website',
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: question.headline,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    alternates: {
      // WS8-T5: canonical self-link (Lighthouse SEO's `canonical` audit).
      canonical: pageUrl,
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

  // WS8-T5 structured data — built from the same `question` this component already fetched
  // (no second DB round-trip); the OG image is already carried by `generateMetadata`'s
  // `openGraph`/`twitter` tags, so JSON-LD's optional `image` field is skipped here rather than
  // re-querying `loadQuestionOg` a second time in the same request just for this.
  const jsonLd = buildQuestionJsonLd({
    headline: question.headline,
    description: describeQuestionState(question),
    pageUrl: `${appUrl()}/q/${question.slug}`,
    datePublished: question.open_at,
    dateModified: question.revealed_at ?? question.lock_at,
  });

  const swipeBallot = isFlagEnabled('swipe_ballot');
  // SW10-T3(a): same server-side, non-viewer flag posture as `swipeBallot` — safe on this ISR'd
  // route for the same reason `swipeBallot` already is (a runtime flag, not per-request data).
  const duoQueue = isFlagEnabled('duo_queue');

  const content = (
    <>
      <QuestionStateView
        question={question}
        serverOffsetMs={serverOffsetMs}
        swipeBallot={swipeBallot}
        streakSlot={swipeBallot ? <StreakBadge /> : undefined}
        // `?arm=1` is intentionally NOT read here (searchParams) — see ViewerStrip's `arm` prop
        // doc: doing so would force this ISR'd (`revalidate = 30`) route into fully dynamic
        // rendering. ViewerStrip self-detects it client-side instead.
        viewerSlot={
          <ViewerStrip question={question} swipeBallot={swipeBallot} duoQueue={duoQueue} />
        }
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </>
  );

  // Design-diff audit: same full-bleed rationale as `app/page.tsx` — see that file's own note.
  if (swipeBallot) {
    return <main className="flex flex-1 flex-col">{content}</main>;
  }

  return <main className="mx-auto max-w-xl space-y-6 px-6 py-10">{content}</main>;
}
