/** MOCK-ONLY route — see `../../route.ts` header for why this exists. */
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { acceptRematchRequest } from '@/lib/nemesis/mock-api';

const bodySchema = z.object({ acting_profile_id: z.string() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return runRoute(async () => {
    const { id } = await params;
    const body = bodySchema.parse(await request.json());
    const result = acceptRematchRequest(id, body.acting_profile_id);
    return jsonSuccess(result);
  });
}
