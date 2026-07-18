/**
 * `GET /api/v1/profiles/:slug` (design doc §9.2, §6.1.2, WS7-T4). Fully public (`auth: none`,
 * INV-10) — no identity resolution, no cookies read. A `deleted` profile (or unknown slug)
 * 404s (WS7-T4 AC). Cacheable per §9.1's default (`public, s-maxage=30,
 * stale-while-revalidate=300` — no endpoint-specific override is noted for this resource).
 */
import type { NextResponse } from 'next/server';
import { ApiError, getProfileRequestSchema } from '@receipts/core';
import { getDb } from '@/lib/stores';
import { getProfilePublicView } from '@/lib/profile-page';
import { jsonSuccess, runRoute } from '@/lib/api-response';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const { slug } = getProfileRequestSchema.shape.params.parse(await params);

    const view = await getProfilePublicView(getDb(), slug);
    if (!view) throw new ApiError('NOT_FOUND', 'profile not found');

    const response = jsonSuccess(view);
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    return response;
  });
}
