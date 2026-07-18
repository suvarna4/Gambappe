/**
 * `GET /api/og/receipt/:pickId` (design doc §10.5): a user's pick — side, entry price,
 * result, streak, handle. Loss + busted-streak variants render here too (P3 — see
 * `renderReceiptTemplate`'s equal treatment of both).
 */
import { getDb } from '@/lib/stores';
import { loadReceiptOg } from '@/lib/og/entities';
import { handleOgRequest } from '@/lib/og/route-handler';
import { renderReceiptTemplate } from '@/lib/og/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ pickId: string }> },
): Promise<Response> {
  const { pickId } = await params;
  return handleOgRequest(request, () => loadReceiptOg(getDb(), pickId), renderReceiptTemplate);
}
