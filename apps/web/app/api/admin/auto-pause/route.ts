/**
 * `GET /api/admin/auto-pause` — the auto-pause review list (§14.3, §15.4, WS10-T4). Shows
 * every profile currently `status='paused_matchmaking'`, however that status got set (the
 * triggering rule itself is WS11-T3 scope). Read-only. Gated by middleware.ts.
 */
import { NextResponse } from 'next/server';
import { nowMs } from '@receipts/core';
import { listAutoPausedProfiles } from '@receipts/db';
import { getDb } from '@/lib/stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const rows = await listAutoPausedProfiles(getDb());
  return NextResponse.json(
    { data: rows },
    { status: 200, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}
