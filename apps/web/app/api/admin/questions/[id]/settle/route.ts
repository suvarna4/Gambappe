/**
 * `PATCH /api/admin/questions/:id/settle` — force-settle (§15.3, WS10-T3). Gated by
 * middleware.ts; audited via withAdminAudit (§15.1 invariant). Thin adapter over
 * `settlement-admin.ts`'s `forceSettleQuestion` — see that file for the actual logic
 * (standard grading pipeline + the ≥30min-after-close gate).
 */
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, now, nowMs } from '@receipts/core';
import { forceSettleQuestion } from '@/lib/settlement-admin';
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

function questionIdFromPath(request: Request): string {
  // .../questions/:id/settle
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
    const result = await forceSettleQuestion(getDb(), questionId, body.outcome, now());
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
  const wrapped = withAdminAudit(getDb(), 'question.force_settle', (req) => new URL(req.url).pathname, patchHandler);
  return wrapped(request);
}
