/**
 * `GET /api/admin/reports` — the reports queue (§15.4, WS10-T4). Read-only: no audit_log
 * row (only mutations are audited, §15.1). Gated by middleware.ts.
 */
import { NextResponse } from 'next/server';
import { nowMs } from '@receipts/core';
import { listOpenReports } from '@receipts/db';
import { getDb } from '@/lib/stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const rows = await listOpenReports(getDb());
  return NextResponse.json(
    { data: rows },
    { status: 200, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}
