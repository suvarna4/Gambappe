/**
 * `GET /api/admin/markets` — the market browser (§15.2, WS10-T2). Gated by middleware.ts.
 * Read-only: no audit_log row (only mutations are audited, §15.1).
 */
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, MARKET_CATEGORY, nowMs, PAGINATION_MAX_LIMIT, VENUE } from '@receipts/core';
import { listMarkets, type MarketCursor } from '@receipts/db';
import { getDb } from '@/lib/stores';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function decodeCursor(raw: string | null): MarketCursor | null {
  if (!raw) return null;
  try {
    const [closeTime, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!closeTime || !id) return null;
    return { closeTime, id };
  } catch {
    return null;
  }
}

function encodeCursor(row: { closeTime: Date; id: string }): string {
  return Buffer.from(`${row.closeTime.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const params = url.searchParams;

  const venue = params.get('venue') ?? undefined;
  if (venue && !(VENUE as readonly string[]).includes(venue)) {
    const err = new ApiError('VALIDATION_FAILED', `Invalid venue "${venue}"`);
    return NextResponse.json(errorEnvelope(err), { status: err.status });
  }
  const category = params.get('category') ?? undefined;
  if (category && !(MARKET_CATEGORY as readonly string[]).includes(category)) {
    const err = new ApiError('VALIDATION_FAILED', `Invalid category "${category}"`);
    return NextResponse.json(errorEnvelope(err), { status: err.status });
  }

  const closeBeforeRaw = params.get('close_before');
  const closeAfterRaw = params.get('close_after');
  const minLiquidityRaw = params.get('min_liquidity_usd');
  const limitRaw = params.get('limit');
  const limit = Math.min(PAGINATION_MAX_LIMIT, Math.max(1, Number(limitRaw) || PAGINATION_MAX_LIMIT));

  const rows = await listMarkets(
    getDb(),
    {
      venue,
      category,
      status: params.get('status') ?? 'open',
      closeBefore: closeBeforeRaw ? new Date(closeBeforeRaw) : undefined,
      closeAfter: closeAfterRaw ? new Date(closeAfterRaw) : undefined,
      minLiquidityUsd: minLiquidityRaw ? Number(minLiquidityRaw) : undefined,
    },
    decodeCursor(params.get('cursor')),
    limit,
  );

  const last = rows.at(-1);
  return NextResponse.json(
    {
      data: rows,
      meta: { next_cursor: last && rows.length === limit ? encodeCursor(last) : null },
    },
    { status: 200, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}
