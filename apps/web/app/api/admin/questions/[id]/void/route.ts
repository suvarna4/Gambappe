/**
 * `PATCH /api/admin/questions/:id/void` — void with reason, both pre-reveal and the post-reveal
 * override path (§15.3, §5.7, WS10-T3). Gated by middleware.ts; audited via withAdminAudit
 * (§15.1 invariant). Thin adapter over `settlement-admin.ts`'s `voidQuestionAdmin`.
 */
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, now, nowMs } from '@receipts/core';
import { voidQuestionAdmin } from '@/lib/settlement-admin';
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
  // .../questions/:id/void
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
  const body = json as { reason?: unknown };
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    return rejected(new ApiError('VALIDATION_FAILED', 'reason must be a non-empty string'));
  }

  try {
    const result = await voidQuestionAdmin(getDb(), questionId, body.reason, now());
    if (!result.voided) return rejected(new ApiError('VALIDATION_FAILED', 'question is not in a voidable state'));
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
  const wrapped = withAdminAudit(getDb(), 'question.void', (req) => new URL(req.url).pathname, patchHandler);
  return wrapped(request);
}
