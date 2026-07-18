/**
 * Server-side assembly of the `QuestionPublic` contract shape (packages/core/src/schemas/
 * questions.ts, §9.2 `GET /questions/today` / `GET /questions/:slug`) directly from Postgres,
 * for SSR rendering of `/` and `/q/[slug]` (WS7-T2, §10.1–10.3).
 *
 * Why this reads the DB directly instead of calling the real HTTP route: WS3-T1/T2 (daily
 * question lifecycle + the pick API, which owns the real `GET /api/v1/questions/*` routes)
 * aren't merged yet — `docs/workstream-locks.md` shows WS3-T2 still `in_review`. The design doc
 * explicitly pre-approves this: §19.2 lists "WS7-T2 (vs WS3-T2)" under Mock-start OK ("begin
 * against the packages/core contracts and mocks, merge after the dependency"), and §0.2 says
 * "if your upstream task isn't merged, code against the contract and the mock." This module
 * targets `questionPublicSchema` byte-for-byte (asserted via `.parse` below, so any drift from
 * the real contract fails loudly) and also matches this repo's own established SSR pattern of
 * server components reading `@receipts/db` directly rather than self-fetching their own API
 * (see `apps/web/app/admin/ops/page.tsx`, `apps/web/app/admin/metrics/page.tsx`) — Next.js's
 * documented recommendation is to avoid a same-process HTTP round trip for the initial render
 * anyway. Once WS3-T2 merges, a follow-up can fold this into (or delegate to) its route logic;
 * either is contract-compatible since both target the same zod schema.
 *
 * The client-side pick/undo/poll surface (`lib/pick-client.ts`) genuinely cannot do this —
 * browser JS has no DB access — so those calls hit the real HTTP paths and simply won't
 * function until WS3-T2 ships the route handlers (documented there).
 */
import { and, eq, ne } from 'drizzle-orm';
import { nowMs as coreNowMs, questionPublicSchema, type QuestionPublic } from '@receipts/core';
import { markets, questions, type Db } from '@receipts/db';
import { crowdSplit } from '@receipts/ui';
import { etDateString } from './ops-dashboard';

export type QuestionRow = typeof questions.$inferSelect;
export type MarketRow = typeof markets.$inferSelect;

type EffectiveStatus = QuestionPublic['status'];

/**
 * §5.7 "Effective-state rule": read paths derive presentation from timestamps, not the raw
 * `status` column alone — a question whose `lock_at` has passed renders as locked even if the
 * lock job hasn't run yet (worker-outage tolerance; the pick API independently enforces
 * `lock_at` via the DB clock, §6.2). The design doc names the open→locked edge explicitly;
 * this applies the same reasoning symmetrically to scheduled→open, since §5.7's stated
 * principle ("read paths derive presentation from timestamps, not status alone") isn't scoped
 * to one edge only and a worker outage can just as easily leave `open_at` unflipped.
 * `revealed`/`voided` are always terminal for display — reaching them requires real settlement
 * work (grading, the reveal job, or an admin void), never just elapsed time, so no timestamp
 * can promote a question into either.
 */
export function deriveEffectiveStatus(
  row: Pick<QuestionRow, 'status' | 'openAt' | 'lockAt'>,
  nowMsValue: number,
): EffectiveStatus {
  if (row.status === 'revealed' || row.status === 'voided' || row.status === 'draft') {
    return row.status;
  }
  if (nowMsValue < row.openAt.getTime()) return 'scheduled';
  if (nowMsValue < row.lockAt.getTime()) return 'open';
  return 'locked';
}

/**
 * Assembles the §9.2 public question shape from raw rows, applying the effective-status rule
 * above and the §9.3 crowd-hiding rule ("hidden while `open` — everywhere, with no exceptions").
 * `.parse`s the result against the real contract schema before returning — any field drift
 * between this assembly and `questionPublicSchema` fails the calling request loudly rather
 * than silently shipping a malformed page.
 */
export function toQuestionPublic(
  question: QuestionRow,
  market: MarketRow,
  nowMsValue: number,
): QuestionPublic {
  const status = deriveEffectiveStatus(question, nowMsValue);

  // §9.3: null while `scheduled`/`open` — no exceptions. Once locked/revealed/voided, both API
  // and page read the LOCK snapshot (never the live counters), same as the reveal display and
  // the contrarian metric (§5.3 `crowd_yes_at_lock`/`crowd_no_at_lock` column notes). A question
  // voided before ever locking has no snapshot to show, so crowd stays null.
  const crowdEligible = status === 'locked' || status === 'revealed' || status === 'voided';
  const hasLockSnapshot = question.crowdYesAtLock !== null && question.crowdNoAtLock !== null;
  const crowd =
    crowdEligible && hasLockSnapshot
      ? {
          yes: question.crowdYesAtLock!,
          no: question.crowdNoAtLock!,
          pct_yes: crowdSplit(question.crowdYesAtLock!, question.crowdNoAtLock!).yesPct,
        }
      : null;

  if (!question.slug) {
    // Curated-but-unslugged questions aren't spectator-servable; callers treat this as
    // not-found rather than crash (draft rows are already filtered at the query level, but a
    // defensive guard here keeps this function safe to call directly in tests).
    throw new Error(`question ${question.id} has no slug — not servable`);
  }

  const publicShape: QuestionPublic = {
    id: question.id as QuestionPublic['id'],
    slug: question.slug,
    kind: question.kind,
    status,
    question_date: question.questionDate,
    headline: question.headline,
    blurb: question.blurb,
    yes_label: question.yesLabel,
    no_label: question.noLabel,
    open_at: question.openAt.toISOString(),
    lock_at: question.lockAt.toISOString(),
    reveal_at: question.revealAt.toISOString(),
    yes_price: market.yesPrice,
    yes_price_updated_at: market.yesPriceUpdatedAt ? market.yesPriceUpdatedAt.toISOString() : null,
    crowd,
    outcome: question.outcome,
    revealed_at: question.revealedAt ? question.revealedAt.toISOString() : null,
    void_reason: question.voidReason,
    is_volatile: question.isVolatile,
    venue: market.venue,
    venue_url: market.venueUrl,
  };

  return questionPublicSchema.parse(publicShape);
}

async function loadQuestionWithMarket(
  db: Db,
  where: ReturnType<typeof eq> | ReturnType<typeof and>,
): Promise<{ question: QuestionRow; market: MarketRow } | null> {
  const rows = await db
    .select({ question: questions, market: markets })
    .from(questions)
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .where(where)
    .limit(1);
  return rows[0] ?? null;
}

/** `GET /questions/:slug` shape (§9.2), read straight from Postgres — see file header. */
export async function getQuestionPublicBySlug(
  db: Db,
  slug: string,
  opts: { nowMsValue?: number } = {},
): Promise<QuestionPublic | null> {
  const nowMsValue = opts.nowMsValue ?? coreNowMs();
  const found = await loadQuestionWithMarket(
    db,
    and(eq(questions.slug, slug), ne(questions.status, 'draft')),
  );
  if (!found) return null;
  return toQuestionPublic(found.question, found.market, nowMsValue);
}

/**
 * `GET /questions/today` shape (§9.2): the daily question whose `question_date` is today's ET
 * calendar date (DD-1: single global schedule in America/New_York).
 */
export async function getTodayQuestionPublic(
  db: Db,
  opts: { nowMsValue?: number } = {},
): Promise<QuestionPublic | null> {
  const nowMsValue = opts.nowMsValue ?? coreNowMs();
  const today = etDateString(new Date(nowMsValue));
  const found = await loadQuestionWithMarket(
    db,
    and(
      eq(questions.kind, 'daily'),
      eq(questions.questionDate, today),
      ne(questions.status, 'draft'),
    ),
  );
  if (!found) return null;
  return toQuestionPublic(found.question, found.market, nowMsValue);
}
