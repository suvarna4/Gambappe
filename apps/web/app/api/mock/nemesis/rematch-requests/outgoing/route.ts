/** MOCK-ONLY route, mock-UI-only discovery — see `../incoming/route.ts` header. */
import type { NextResponse } from 'next/server';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { getOutgoingRematchRequest } from '@/lib/nemesis/mock-api';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const url = new URL(request.url);
    const requesterProfileId = url.searchParams.get('requester_profile_id') ?? '';
    const targetProfileId = url.searchParams.get('target_profile_id') ?? '';
    return jsonSuccess({
      request: getOutgoingRematchRequest(requesterProfileId, targetProfileId),
    });
  });
}
