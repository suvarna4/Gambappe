/**
 * `GET /api/v1/me/nemesis-history` (design doc §9.2, §9.1 cursor pagination, WS5-T4): the
 * claimed viewer's lifetime record vs past nemeses. Behind the `nemesis` flag (§4.6). Business
 * logic lives in `@/lib/nemesis/service` (§4.3).
 */
import type { NextResponse } from 'next/server';
import { ApiError, getNemesisHistoryRequestSchema, isFlagEnabled } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { enforceGetBackstop } from '@/lib/rate-limit';
import { getDb } from '@/lib/stores';
import { getNemesisHistoryPage } from '@/lib/nemesis/service';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const limited = await enforceGetBackstop(request);
    if (limited) return limited;

    if (!isFlagEnabled('nemesis')) {
      throw new ApiError('NOT_FOUND', 'nemesis is not available');
    }

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') {
      throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');
    }

    const url = new URL(request.url);
    const { query } = getNemesisHistoryRequestSchema.parse({
      query: {
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      },
    });

    const page = await getNemesisHistoryPage(getDb(), identity.profile.id, query);
    return jsonSuccess(page);
  });
}
