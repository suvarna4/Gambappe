/**
 * `GET /api/admin/bot-flags` — the bot-flag review list (§14.2, §15.4, WS10-T4). Read-only:
 * "surfaced in admin queue for review; never auto-banned" — no resolve action exists here by
 * design. Gated by middleware.ts.
 */
import { NextResponse } from 'next/server';
import { BOT_EXCLUDE_THRESHOLD, nowMs } from '@receipts/core';
import { listBotFlaggedProfiles } from '@receipts/db';
import { getDb } from '@/lib/stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const rows = await listBotFlaggedProfiles(getDb(), BOT_EXCLUDE_THRESHOLD);
  return NextResponse.json(
    { data: rows },
    { status: 200, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}
