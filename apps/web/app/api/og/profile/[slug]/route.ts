/**
 * `GET /api/og/profile/:slug` (design doc §10.5): record summary card.
 */
import { getDb } from '@/lib/stores';
import { loadProfileOg } from '@/lib/og/entities';
import { handleOgRequest } from '@/lib/og/route-handler';
import { renderProfileTemplate } from '@/lib/og/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return handleOgRequest(request, () => loadProfileOg(getDb(), slug), renderProfileTemplate);
}
