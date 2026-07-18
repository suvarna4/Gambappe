/**
 * `GET /api/og/duo/:duoId` (design doc §10.5): partners + tier + rating card.
 */
import { getDb } from '@/lib/stores';
import { loadDuoOg } from '@/lib/og/entities';
import { handleOgRequest } from '@/lib/og/route-handler';
import { renderDuoTemplate } from '@/lib/og/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ duoId: string }> },
): Promise<Response> {
  const { duoId } = await params;
  return handleOgRequest(request, () => loadDuoOg(getDb(), duoId), renderDuoTemplate);
}
