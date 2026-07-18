/**
 * `GET /api/admin/audit-log` (§15.1, §15.5, WS10-T1). Gated by middleware.ts (admin stopgap
 * auth) — this handler assumes it only ever runs for an authorized caller. Read-only, so no
 * audit_log row of its own (only mutations are audited).
 */
import { NextResponse } from 'next/server';
import { nowMs } from '@receipts/core';
import { listAuditLog } from '@receipts/db';
import { getDb } from '@/lib/stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const rows = await listAuditLog(getDb(), 50);
  return NextResponse.json(
    { data: rows },
    { status: 200, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}
