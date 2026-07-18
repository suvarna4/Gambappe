/**
 * `GET /api/og/matchup/:pairingId` (design doc §10.5): nemesis scoreboard card.
 */
import { getDb } from '@/lib/stores';
import { loadMatchupOg } from '@/lib/og/entities';
import { handleOgRequest } from '@/lib/og/route-handler';
import { renderMatchupTemplate } from '@/lib/og/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ pairingId: string }> },
): Promise<Response> {
  const { pairingId } = await params;
  return handleOgRequest(request, () => loadMatchupOg(getDb(), pairingId), renderMatchupTemplate);
}
