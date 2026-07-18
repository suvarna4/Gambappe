/**
 * MOCK-ONLY route — see `../route.ts` header for why this exists. Also NOT a preview of a
 * real WS5-T4 endpoint: §9.2 has no `GET` for a profile's own rematch requests at all (see
 * the SPEC-GAP in `mock-api.ts`'s file header) — this is purely a mock-UI convenience.
 */
import type { NextResponse } from 'next/server';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { getIncomingRematchRequest } from '@/lib/nemesis/mock-api';

export async function GET(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    const profileId = new URL(request.url).searchParams.get('profile_id') ?? '';
    return jsonSuccess({ request: getIncomingRematchRequest(profileId) });
  });
}
