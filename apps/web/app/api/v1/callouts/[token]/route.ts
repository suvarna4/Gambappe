/**
 * `GET /api/v1/callouts/:token` (journeys plan §5 WS20-T3, D-J5). Public preview
 * (`calloutPreviewSchema`): challenger ref, status, expiry — spectator-safe fields only, never
 * the opponent or any internal id. Hashes the incoming raw token and looks it up. Expired → 410
 * (`CALLOUT_EXPIRED`), missing → 404. Flag-gated on `callouts` (404 when off), GET backstop
 * rate-limited. Business logic lives in `@/lib/callouts`.
 */
import type { NextResponse } from 'next/server';
import { ApiError, calloutTokenParamsSchema, isFlagEnabled, now } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { calloutErrorResponse } from '@/lib/callout-response';
import { getCalloutPreview } from '@/lib/callouts';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    if (!isFlagEnabled('callouts')) {
      throw new ApiError('NOT_FOUND', 'call-outs are not available');
    }

    const { token } = calloutTokenParamsSchema.parse(await params);

    const result = await getCalloutPreview(getDb(), token, now());
    if (!result.ok) return calloutErrorResponse(result.reason);
    return jsonSuccess(result.preview);
  });
}
