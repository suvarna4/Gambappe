/**
 * `POST /api/v1/events` — analytics ingest (design doc §13.1, §9.2 WS13-T1).
 *
 * Fire-and-forget: this endpoint always responds 202 `{data:{accepted:true}}` once the body
 * is structurally valid. Unknown event names and oversized `props` are DROPPED SILENTLY
 * (never a 4xx) — a client sending analytics should never have to handle an error path for
 * "the server didn't recognize this event." Only a malformed request body (not matching the
 * base shape at all) is rejected.
 */
import { NextResponse } from 'next/server';
import {
  ApiError,
  errorEnvelope,
  eventIngestBodySchema,
  EVENT_PROPS_MAX_BYTES,
  isAnalyticsEventName,
  nowMs,
} from '@receipts/core';
import { getDb, getRedis } from '@/lib/stores';
import { hashRequestMeta } from '@/lib/analytics';
import { emitEvent } from '@/lib/emit-event';
import { clientIpKey, enforceRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function accepted(): NextResponse {
  return NextResponse.json(
    { data: { accepted: true } },
    { status: 202, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}

function rejected(err: ApiError): NextResponse {
  return NextResponse.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  // §14.1: POST /events, 120/hour per IP. Checked first — before parsing the body — since
  // the whole point is protecting against a flood of requests, not just malformed ones.
  const rateLimited = await enforceRateLimit('events', clientIpKey(request.headers));
  if (rateLimited) return rateLimited;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return rejected(new ApiError('VALIDATION_FAILED', 'Body must be valid JSON'));
  }

  const parsed = eventIngestBodySchema.safeParse(json);
  if (!parsed.success) {
    return rejected(
      new ApiError('VALIDATION_FAILED', 'Invalid event payload', parsed.error.flatten()),
    );
  }

  const { event, props, anon_id } = parsed.data;

  // Unknown events dropped silently (§13.1) — not a client-visible error.
  if (!isAnalyticsEventName(event)) {
    return accepted();
  }

  // Oversized props drop the whole event, not just the field (§5.6).
  if (Buffer.byteLength(JSON.stringify(props), 'utf8') > EVENT_PROPS_MAX_BYTES) {
    return accepted();
  }

  // anon_id: strict UUID or ignored (§9.2) — malformed values never fail the request.
  const anonId = anon_id && UUID_RE.test(anon_id) ? anon_id : null;

  // TODO(WS13-T1): populate profileId/isGhost from resolved identity once WS2-T1's
  // ghost/session cookie middleware lands — this endpoint's own auth is `none` (§9.2), so
  // identity is opportunistic here, never required.
  const { ipHash, uaHash } = await hashRequestMeta(request.headers, getRedis());
  await emitEvent(getDb(), { event, props, anonId, ipHash, uaHash });

  return accepted();
}
