/**
 * `POST /api/v1/internal/revalidate` (design doc §9.2, §10.2, WS8-T3): worker→web ISR
 * revalidation hook. Bearer `INTERNAL_API_SECRET` (constant-time compare); hardened per spec:
 * paths must match `REVALIDATE_PATH_ALLOWLIST` (`/q/*`, `/p/*`, `/vs/*`, `/duos/*`, `/`, `/q`),
 * capped at `REVALIDATE_MAX_PATHS` per call (enforced by `revalidateBodySchema` itself), and
 * globally rate-limited (`RL_REVALIDATE_MIN`) — "a leaked secret must not enable a
 * cache-stampede DoS" (§9.2). Out-of-allowlist paths are REJECTED, not silently dropped: the
 * call still succeeds (200) for the paths that were allowed, with rejected ones itemized in
 * the response, so the worker can alert on unexpected rejections without every call failing
 * outright over one bad path.
 */
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import {
  errorEnvelope,
  nowMs,
  REVALIDATE_PATH_ALLOWLIST,
  revalidateRequestSchema,
} from '@receipts/core';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isInternalRequestAuthorized } from '@/lib/internal-auth';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAllowedPath(path: string): boolean {
  return REVALIDATE_PATH_ALLOWLIST.some((pattern) => pattern.test(path));
}

export async function POST(request: Request): Promise<NextResponse> {
  // Auth before rate limit: an unauthorized caller shouldn't be able to burn the *global*
  // budget (§9.2's "global" key means every legitimate worker call shares it with every
  // attacker guess) — same ordering rationale as §14.1's "origin check → identity → limiter".
  if (!isInternalRequestAuthorized(request.headers)) {
    return NextResponse.json(
      errorEnvelope('UNAUTHENTICATED', 'missing or invalid bearer token'),
      { status: 401, headers: { 'x-server-time': String(nowMs()) } },
    );
  }

  const rateLimited = await enforceRateLimit('internal_revalidate', 'global');
  if (rateLimited) return rateLimited;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(errorEnvelope('VALIDATION_FAILED', 'Body must be valid JSON'), {
      status: 400,
      headers: { 'x-server-time': String(nowMs()) },
    });
  }

  const parsed = revalidateRequestSchema.shape.body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      errorEnvelope('VALIDATION_FAILED', 'Invalid revalidate payload', parsed.error.flatten()),
      { status: 400, headers: { 'x-server-time': String(nowMs()) } },
    );
  }

  const revalidated: string[] = [];
  const rejected: string[] = [];
  for (const path of parsed.data.paths) {
    if (!isAllowedPath(path)) {
      rejected.push(path);
      continue;
    }
    try {
      // `revalidatePath` requires Next's per-request store, which only exists inside a real
      // server request; it's a no-op-safe call to wrap defensively rather than let one bad
      // path 500 the whole (already-allowlisted) batch — logged so a genuine failure is
      // still observable (§16.1).
      revalidatePath(path);
    } catch (err) {
      logger.warn({ err, path }, 'POST /internal/revalidate: revalidatePath threw, continuing');
    }
    revalidated.push(path);
  }

  return NextResponse.json(
    { data: { revalidated, rejected } },
    { status: 200, headers: { 'x-server-time': String(nowMs()) } },
  );
}
