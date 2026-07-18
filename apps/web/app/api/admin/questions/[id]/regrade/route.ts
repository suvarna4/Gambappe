/**
 * `PATCH /api/admin/questions/:id/regrade` — flip an already-settled outcome within
 * `REGRADE_WINDOW_H` (§15.3, §6.5, WS10-T3). Gated by middleware.ts; audited via
 * withAdminAudit (§15.1 invariant). Thin adapter over `settlement-admin.ts`'s
 * `regradeQuestion` — see that file for the actual logic (re-score picks, replay streaks,
 * recompute percentiles; daily questions only in this wave).
 */
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, now, nowMs } from '@receipts/core';
import { regradeQuestion } from '@/lib/settlement-admin';
import { getDb, getRedis } from '@/lib/stores';
import { withAdminAudit } from '@/lib/admin-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function rejected(err: ApiError): NextResponse {
  return NextResponse.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

function questionIdFromPath(request: Request): string {
  // .../questions/:id/regrade
  return new URL(request.url).pathname.split('/').at(-2)!;
}

async function patchHandler(request: Request): Promise<NextResponse> {
  const questionId = questionIdFromPath(request);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return rejected(new ApiError('VALIDATION_FAILED', 'Body must be valid JSON'));
  }
  const body = json as { outcome?: unknown };
  if (body.outcome !== 'yes' && body.outcome !== 'no') {
    return rejected(new ApiError('VALIDATION_FAILED', 'outcome must be "yes" or "no"'));
  }

  try {
    const result = await regradeQuestion(getDb(), getRedis(), questionId, body.outcome, now());
    return NextResponse.json(
      { data: result },
      { status: 200, headers: { 'x-server-time': String(nowMs()) } },
    );
  } catch (err) {
    if (ApiError.is(err)) return rejected(err);
    throw err;
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const wrapped = withAdminAudit(getDb(), 'question.regrade', (req) => new URL(req.url).pathname, patchHandler);
  return wrapped(request);
}
