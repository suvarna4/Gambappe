/**
 * `GET /api/admin/questions/preview` — "renders the exact spectator page" (§15.2, WS10-T2).
 * WS7-T2's actual page doesn't exist yet, so parity is proven at the data-contract level:
 * this returns a `questionPublicSchema`-shaped object (the same shape the spectator page
 * will consume) computed exactly as the composer would, without persisting anything.
 *
 * Never 400s for business-rule violations — the curator calls this on every keystroke while
 * filling out the composer form, so validation errors come back as `errors` in a 200, not an
 * HTTP error. Only a truly malformed request (missing/invalid market_id) is rejected.
 */
import { NextResponse } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { ApiError, errorEnvelope, nowMs } from '@receipts/core';
import { getMarketById } from '@receipts/db';
import { getDb } from '@/lib/stores';
import {
  buildQuestionPreview,
  buildQuestionSlug,
  composerBodySchema,
  resolveComposerTimes,
  validateComposerInput,
  type ComposerBody,
} from '@/lib/curation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function paramsToBody(params: URLSearchParams): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.fromEntries(params.entries());
  // `token` is the WS10-T2 browser-nav auth fallback (middleware strips it before this
  // handler's business logic runs conceptually) — never part of the composer schema.
  delete raw['token'];
  if ('is_volatile' in raw) raw['is_volatile'] = raw['is_volatile'] === 'true';
  return raw;
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const parsed = composerBodySchema.partial({
    headline: true,
    yes_label: true,
    no_label: true,
    question_date: true,
  }).safeParse(paramsToBody(params));

  if (!parsed.success || !parsed.data.market_id) {
    const err = new ApiError('VALIDATION_FAILED', 'market_id is required', parsed.success ? undefined : parsed.error.flatten());
    return NextResponse.json(errorEnvelope(err), { status: err.status });
  }

  const market = await getMarketById(getDb(), parsed.data.market_id);
  if (!market) {
    const err = new ApiError('NOT_FOUND', 'Market not found');
    return NextResponse.json(errorEnvelope(err), { status: err.status });
  }

  // Fill in placeholders for fields not yet typed by the curator, so times/validation can
  // still run — the preview is meant to update live as the form is filled in. `parsed.data`
  // already satisfied composerBodySchema's non-length constraints (only these four fields
  // were made optional above), so this assigns defaults directly rather than re-validating
  // through the full schema — headline/yes_label/no_label's `min(1)` is a real-submission
  // rule, not something an untyped-so-far preview request should ever 500 on.
  const body: ComposerBody = {
    ...parsed.data,
    headline: parsed.data.headline ?? '',
    yes_label: parsed.data.yes_label ?? '',
    no_label: parsed.data.no_label ?? '',
    question_date: parsed.data.question_date ?? new Date().toISOString().slice(0, 10),
  };

  const times = resolveComposerTimes(body);
  const errors = validateComposerInput(
    { category: market.category, closeTime: market.closeTime, expectedResolveTime: market.expectedResolveTime },
    times,
  );

  const slug = buildQuestionSlug(body.question_date, body.headline || 'untitled');
  const preview =
    errors.length === 0
      ? buildQuestionPreview(uuidv7(), slug, body, times, {
          venue: market.venue,
          venueUrl: market.venueUrl,
          yesPrice: market.yesPrice,
          yesPriceUpdatedAt: market.yesPriceUpdatedAt,
        })
      : null;

  return NextResponse.json(
    { data: { question: preview, errors } },
    { status: 200, headers: { 'x-server-time': String(nowMs()), 'cache-control': 'no-store' } },
  );
}
