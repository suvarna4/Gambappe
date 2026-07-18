/**
 * `GET /api/og/question/:slug` (design doc §10.5): the `question` (pre-lock) / `result`
 * (revealed) / voided OG card for a single question — one entity, template chosen by its
 * current lifecycle state.
 */
import { getDb } from '@/lib/stores';
import { loadQuestionOg } from '@/lib/og/entities';
import { handleOgRequest } from '@/lib/og/route-handler';
import { renderQuestionTemplate } from '@/lib/og/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return handleOgRequest(request, () => loadQuestionOg(getDb(), slug), renderQuestionTemplate);
}
