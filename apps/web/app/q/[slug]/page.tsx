/**
 * `/q/[slug]` — the spectator page (design doc §10.1, §10.2, INV-10). ISR, revalidate 30s +
 * on-demand via `/internal/revalidate` (WS8-T3).
 *
 * SPEC-GAP(WS8-T3) / mock scaffold: this is a minimal placeholder pending WS7-T2 ("Home +
 * question page"), which owns the real state-machine UI (§10.3: scheduled/open/locked/
 * revealed/voided, pick buttons, the reveal choreography). See the loader's own doc comment
 * (`lib/spectator/question-page-view.ts`) for what must be preserved when WS7-T2 replaces
 * this: the server render must keep reading zero viewer-specific data (no cookies, no
 * `GET /me`) so the CDN cache key never needs to vary on identity (§10.2's INV-10 guarantee,
 * tested in `test/spectator-cache-key.test.ts`). The viewer strip (pick buttons / your
 * receipt / claim prompt) is a **client-side island** per spec — deliberately absent here.
 */
import { notFound } from 'next/navigation';
import { loadQuestionPageView } from '@/lib/spectator/question-page-view';

// Next.js statically extracts route segment config via AST analysis at build time — it
// must be a literal, not an imported identifier (importing `ISR_REVALIDATE_QUESTION_S`
// here fails the build with "Unknown identifier ... at revalidate"). The literal is pinned
// back to `@receipts/core`'s single source of truth by
// `test/integration/spectator-question-page.test.ts`, which asserts this equals
// `ISR_REVALIDATE_QUESTION_S` at runtime — keep the two in sync by hand if Appendix D changes.
export const revalidate = 30; // ISR_REVALIDATE_QUESTION_S (design doc §10.1 route table)

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const view = await loadQuestionPageView(slug);
  if (!view) return { title: 'Receipts' };
  return {
    title: view.headline,
    description: `The crowd's call on: ${view.headline}`,
  };
}

export default async function QuestionPage({ params }: PageProps) {
  const { slug } = await params;
  const view = await loadQuestionPageView(slug);
  if (!view) notFound();

  return (
    <main>
      <h1>{view.headline}</h1>
      {view.blurb && <p>{view.blurb}</p>}
      <p>Status: {view.status}</p>
      {view.yesPrice != null && <p>Live YES price: {Math.round(view.yesPrice * 100)}¢</p>}
      {view.crowd ? (
        <p>Crowd: {view.crowd.yesPct}% {view.yesLabel}</p>
      ) : (
        <p>Crowd locks in at {new Date(view.lockAt).toISOString()}</p>
      )}
      {view.outcome && <p>Outcome: {view.outcome === 'yes' ? view.yesLabel : view.noLabel}</p>}
      {/* Viewer strip (your pick / pick buttons / claim prompt) hydrates client-side only —
          §10.2 keeps this server render viewer-free. WS7-T2 scope. */}
    </main>
  );
}
