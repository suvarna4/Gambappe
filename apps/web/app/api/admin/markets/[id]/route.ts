/**
 * `PATCH /api/admin/markets/:id` — market curation tagging (§15.2, WS10-T2): toggles
 * `nemesis_eligible` (also the `duo_bonus` pool signal — no separate column exists).
 * Gated by middleware.ts; audited via withAdminAudit (§15.1 invariant).
 */
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, nowMs } from '@receipts/core';
import { getMarketById, updateMarketNemesisEligible } from '@receipts/db';
import { getDb } from '@/lib/stores';
import { withAdminAudit } from '@/lib/admin-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function rejected(err: ApiError): NextResponse {
  return NextResponse.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

async function patchHandler(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).pathname.split('/').at(-1)!;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return rejected(new ApiError('VALIDATION_FAILED', 'Body must be valid JSON'));
  }
  const body = json as { nemesis_eligible?: unknown };
  if (typeof body.nemesis_eligible !== 'boolean') {
    return rejected(new ApiError('VALIDATION_FAILED', 'nemesis_eligible must be a boolean'));
  }

  const market = await getMarketById(getDb(), id);
  if (!market) return rejected(new ApiError('NOT_FOUND', 'Market not found'));

  const updated = await updateMarketNemesisEligible(getDb(), id, body.nemesis_eligible);
  return NextResponse.json(
    { data: updated },
    { status: 200, headers: { 'x-server-time': String(nowMs()) } },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  // getDb() is deliberately called here, not at module scope — this route module may be
  // loaded during Next's build-time analysis, before DATABASE_URL is guaranteed to exist.
  const wrapped = withAdminAudit(getDb(), 'market.tag', (req) => new URL(req.url).pathname, patchHandler);
  return wrapped(request);
}
