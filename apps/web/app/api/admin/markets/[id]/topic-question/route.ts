/**
 * `POST /api/admin/markets/:id/topic-question` — "Publish as topic question" (journeys plan §5
 * WS18-T1). Creates a `kind='topic'` question from a venue market: `open_at=now` (born `open`, so
 * it appears in the stack feed immediately), `lock_at=market.close_time`, editable headline, slug
 * `{ET-date}-{slugified venueMarketId}`. Topic questions carry no `question_date` (no daily
 * uniqueness) and no synchronized reveal — settlement follows the venue market (D-J3), so only the
 * kind-agnostic `question:lock` job is scheduled (see `scheduleTopicQuestionLock`).
 *
 * Flag-gated on `topic_markets`: off → 404 (the admin affordance is hidden client-side too).
 * Gated by middleware.ts; audited via withAdminAudit (§15.1 invariant).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { ApiError, errorEnvelope, etDateString, isFlagEnabled, now, nowMs, slugifyHandle } from '@receipts/core';
import { getMarketById, getQuestionBySlug, insertQuestion } from '@receipts/db';
import { getDb } from '@/lib/stores';
import { withAdminAudit } from '@/lib/admin-audit';
import { scheduleTopicQuestionLock } from '@/lib/question-lifecycle-queue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const topicQuestionBodySchema = z
  .object({
    headline: z.string().min(1).max(200),
    blurb: z.string().max(500).nullable().optional(),
    // Labels default to Yes/No (a topic card's sides are usually the market's own) but stay
    // editable, mirroring the daily composer's required labels.
    yes_label: z.string().min(1).max(50).optional(),
    no_label: z.string().min(1).max(50).optional(),
  })
  .strict();

function rejected(err: ApiError): NextResponse {
  return NextResponse.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

async function postHandler(request: Request): Promise<NextResponse> {
  if (!isFlagEnabled('topic_markets')) {
    return rejected(new ApiError('NOT_FOUND', 'not found'));
  }

  const id = new URL(request.url).pathname.split('/').at(-2)!; // .../markets/:id/topic-question

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return rejected(new ApiError('VALIDATION_FAILED', 'Body must be valid JSON'));
  }
  const parsed = topicQuestionBodySchema.safeParse(json);
  if (!parsed.success) {
    return rejected(new ApiError('VALIDATION_FAILED', 'Invalid topic-question input', parsed.error.flatten()));
  }
  const body = parsed.data;

  const db = getDb();
  const market = await getMarketById(db, id);
  if (!market) return rejected(new ApiError('NOT_FOUND', 'Market not found'));

  const at = now();
  const openAt = at;
  const lockAt = market.closeTime;
  // A topic whose market has already closed would be born past its lock — useless (it never
  // appears open in the feed). Reject rather than persist a stillborn card.
  if (lockAt.getTime() <= at.getTime()) {
    return rejected(
      new ApiError('VALIDATION_FAILED', 'market close_time is already in the past — nothing to open'),
    );
  }
  // No synchronized reveal (D-J3): reveal target is the market's expected resolution, falling back
  // to close_time. `reveal_at` is NOT NULL in the schema and is only a target, never a real gate
  // for topics (they settle when the venue market resolves).
  const revealAt = market.expectedResolveTime ?? market.closeTime;

  // Slug `{ET-date}-{slugified venueMarketId}` (§5 WS18-T1). Suffix-probe for uniqueness the same
  // way the daily composer does — two topics off one market on one day would otherwise collide on
  // `questions_slug_uq`.
  const baseSlug = `${etDateString(at)}-${slugifyHandle(market.venueMarketId)}`;
  let slug = baseSlug;
  for (let n = 2; (await getQuestionBySlug(db, slug)) !== null; n++) {
    if (n > 20) {
      return rejected(new ApiError('VALIDATION_FAILED', 'Could not find a free slug for this market/date'));
    }
    slug = `${baseSlug}-${n}`;
  }

  try {
    const question = await insertQuestion(db, {
      id: uuidv7(),
      kind: 'topic',
      marketId: id,
      questionDate: null, // topics have no daily-date uniqueness (§4)
      slug,
      headline: body.headline,
      blurb: body.blurb ?? null,
      yesLabel: body.yes_label ?? 'Yes',
      noLabel: body.no_label ?? 'No',
      openAt,
      lockAt,
      revealAt,
      status: 'open', // born open (open_at=now) so it surfaces in the stack feed immediately
      createdByUserId: null, // P0 stopgap auth has no per-admin user identity (§19.5)
    });

    // Schedule the lock so the topic exits the feed at close_time. Failure propagates as a 500 on
    // purpose (same posture as the daily composer): the row exists but silently returning 201 would
    // recreate the unscheduled-forever bug; the jobs are idempotent so re-enqueueing is harmless.
    await scheduleTopicQuestionLock(question);

    return NextResponse.json(
      { data: question },
      { status: 201, headers: { 'x-server-time': String(nowMs()) } },
    );
  } catch (err) {
    if (err instanceof Error && /unique|duplicate key/i.test(err.message)) {
      return rejected(new ApiError('VALIDATION_FAILED', 'A topic question with this slug already exists'));
    }
    throw err;
  }
}

export async function POST(request: Request): Promise<Response> {
  const wrapped = withAdminAudit(getDb(), 'topic_question.create', (req) => new URL(req.url).pathname, postHandler);
  return wrapped(request);
}
