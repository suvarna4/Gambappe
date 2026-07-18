/**
 * `PATCH /api/admin/auto-pause/:id` — resolve an auto-paused profile (§14.3, §15.4, WS10-T4):
 * "Admin resolves → restore or suspend." Audited via withAdminAudit (§15.1 invariant).
 */
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, nowMs } from '@receipts/core';
import { getProfileById, updateProfileStatus } from '@receipts/db';
import { getDb } from '@/lib/stores';
import { withAdminAudit } from '@/lib/admin-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const resolveBodySchema = z.object({
  action: z.enum(['restore', 'suspend']),
});

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
  const parsed = resolveBodySchema.safeParse(json);
  if (!parsed.success) {
    return rejected(new ApiError('VALIDATION_FAILED', 'Invalid resolve action', parsed.error.flatten()));
  }

  const db = getDb();
  const profile = await getProfileById(db, id);
  if (!profile) return rejected(new ApiError('NOT_FOUND', 'Profile not found'));
  if (profile.status !== 'paused_matchmaking') {
    return rejected(new ApiError('VALIDATION_FAILED', `Profile is not pending auto-pause review (status=${profile.status})`));
  }

  const updated = await updateProfileStatus(db, id, parsed.data.action === 'restore' ? 'active' : 'suspended');
  return NextResponse.json(
    { data: updated },
    { status: 200, headers: { 'x-server-time': String(nowMs()) } },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  const wrapped = withAdminAudit(getDb(), 'profile.auto_pause_resolve', (req) => new URL(req.url).pathname, patchHandler);
  return wrapped(request);
}
