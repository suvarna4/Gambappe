/**
 * `POST /api/admin/questions` — the question composer (§15.2, WS10-T2). Gated by
 * middleware.ts; audited via withAdminAudit (§15.1 invariant). Picks a market, applies the
 * defaults + validations, and creates a `scheduled` daily question.
 */
import { NextResponse } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { ApiError, errorEnvelope, nowMs } from '@receipts/core';
import { getDailyQuestion, getMarketById, getQuestionBySlug, insertQuestion } from '@receipts/db';
import { getDb } from '@/lib/stores';
import { withAdminAudit } from '@/lib/admin-audit';
import { buildQuestionSlug, composerBodySchema, resolveComposerTimes, validateComposerInput } from '@/lib/curation';
import { scheduleDailyQuestionLifecycle } from '@/lib/question-lifecycle-queue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function rejected(err: ApiError): NextResponse {
  return NextResponse.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

async function postHandler(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return rejected(new ApiError('VALIDATION_FAILED', 'Body must be valid JSON'));
  }

  const parsed = composerBodySchema.safeParse(json);
  if (!parsed.success) {
    return rejected(new ApiError('VALIDATION_FAILED', 'Invalid composer input', parsed.error.flatten()));
  }
  const body = parsed.data;

  const db = getDb();
  const market = await getMarketById(db, body.market_id);
  if (!market) return rejected(new ApiError('NOT_FOUND', 'Market not found'));

  const times = resolveComposerTimes(body);
  const errors = validateComposerInput(
    { category: market.category, closeTime: market.closeTime, expectedResolveTime: market.expectedResolveTime },
    times,
  );
  if (errors.length > 0) {
    return rejected(new ApiError('VALIDATION_FAILED', 'Composer validation failed', { errors }));
  }

  // Pre-check for a clean error; the DB's partial unique index (kind='daily', question_date,
  // non-voided — WS15-T2: a voided daily frees its slot for a replacement) is the final
  // backstop against a genuine race between two concurrent composer calls.
  const existingDaily = await getDailyQuestion(db, body.question_date);
  if (existingDaily) {
    return rejected(
      new ApiError('DUPLICATE_DAILY_QUESTION', `A daily question already exists for ${body.question_date}`),
    );
  }

  // A replacement composed with the SAME headline as its voided predecessor would collide on
  // `questions_slug_uq` (voided rows keep their slug — they're history, §5.7). Suffix until
  // free; bounded because each probe either frees or the compose genuinely can't proceed.
  let slug = buildQuestionSlug(body.question_date, body.headline);
  for (let n = 2; (await getQuestionBySlug(db, slug)) !== null; n++) {
    if (n > 10) return rejected(new ApiError('VALIDATION_FAILED', 'Could not find a free slug for this date/headline'));
    slug = `${buildQuestionSlug(body.question_date, body.headline)}-${n}`;
  }
  try {
    const question = await insertQuestion(db, {
      id: uuidv7(),
      kind: 'daily',
      marketId: body.market_id,
      questionDate: body.question_date,
      slug,
      headline: body.headline,
      blurb: body.blurb ?? null,
      yesLabel: body.yes_label,
      noLabel: body.no_label,
      openAt: times.openAt,
      lockAt: times.lockAt,
      revealAt: times.revealAt,
      status: 'scheduled',
      isVolatile: body.is_volatile ?? false,
      eventStartAt: times.eventStartAt,
      pairedMarketId: body.paired_market_id ?? null,
      createdByUserId: null, // P0 stopgap auth has no per-admin user identity (§19.5)
    });

    // §5.3/§6.2: a `scheduled` question is inert until question:open/question:lock/reveal:fire
    // are enqueued at its lifecycle times — without this, the row sits in `scheduled` forever
    // (WS14-T4's Question Zero drill found exactly that: zero pgboss.job rows after curation).
    // A failure here (pg-boss unreachable) propagates as a 500 on purpose: the question row
    // already exists, but silently returning 201 would recreate the unscheduled-forever bug this
    // call fixes. Recovery for that narrow window is the runbook's manual-schedule script
    // (docs/runbooks/launch-drill.md §2); the jobs are idempotent so re-enqueueing is harmless.
    await scheduleDailyQuestionLifecycle(question);

    return NextResponse.json(
      { data: question },
      { status: 201, headers: { 'x-server-time': String(nowMs()) } },
    );
  } catch (err) {
    // Backstop: the unique index rejected a race we didn't catch in the pre-check above.
    if (err instanceof Error && /unique|duplicate key/i.test(err.message)) {
      return rejected(
        new ApiError('DUPLICATE_DAILY_QUESTION', `A daily question already exists for ${body.question_date}`),
      );
    }
    throw err;
  }
}

export async function POST(request: Request): Promise<Response> {
  const wrapped = withAdminAudit(getDb(), 'question.create', (req) => new URL(req.url).pathname, postHandler);
  return wrapped(request);
}
