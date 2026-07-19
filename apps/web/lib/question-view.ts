/**
 * Server-side assembly of the `QuestionPublic` contract shape (packages/core/src/schemas/
 * questions.ts, §9.2 `GET /questions/today` / `GET /questions/:slug`) directly from Postgres,
 * for SSR rendering of `/` and `/q/[slug]` (WS7-T2, §10.1–10.3).
 *
 * Why this reads the DB directly instead of calling the real HTTP route: this is the repo's
 * established SSR pattern — server components read `@receipts/db` directly rather than
 * self-fetching their own API (see `apps/web/app/admin/ops/page.tsx`,
 * `apps/web/app/admin/metrics/page.tsx`); Next.js's documented recommendation is to avoid a
 * same-process HTTP round trip for the initial render anyway. The client-side pick/undo/poll
 * surface (`lib/pick-client.ts`) genuinely cannot do this — browser JS has no DB access — so
 * those calls hit the real HTTP paths.
 *
 * Serialization itself is DELEGATED to `serialize-question.ts` — the exact module the real
 * `GET /api/v1/questions/*` routes use — so the page path and the JSON path cannot drift.
 * That sharing is load-bearing for the §6.5 publication rule: this module originally copied
 * `outcome`/`revealed_at` off the raw row ungated, so an ISR-cached spectator page served a
 * settled-but-unrevealed daily's outcome hours before the synchronized reveal (audit finding
 * 1.1, PR #43). `serializeQuestionPublic` gates both on the RAW `status = 'revealed'` — a real
 * transition performed only by `reveal:fire` (§6.7), never inferred from timestamps — which is
 * precisely the "all public surfaces keep the question in `locked` presentation until reveal"
 * rule. On top of the shared serializer this module adds only a `questionPublicSchema.parse`
 * (any drift from the wire contract fails the calling request loudly rather than silently
 * shipping a malformed page) and the two Postgres lookups.
 */
import { and, eq, ne } from 'drizzle-orm';
import { nowMs as coreNowMs, questionPublicSchema, type QuestionPublic } from '@receipts/core';
import {
  markets,
  questions,
  type Db,
  type MarketRow,
  type QuestionRow,
} from '@receipts/db';
import { effectiveQuestionStatus, serializeQuestionPublic } from './serialize-question';
import { etDateString } from './ops-dashboard';

// Re-exported so existing importers (tests) keep working; these are the same `$inferSelect`
// row types `serialize-question.ts` consumes — one shape across both public read paths.
export type { MarketRow, QuestionRow };

/**
 * §5.7 "Effective-state rule": read paths derive presentation from timestamps, not the raw
 * `status` column alone — a question whose `lock_at` has passed renders as locked even if the
 * lock job hasn't run yet (worker-outage tolerance; the pick API independently enforces
 * `lock_at` via the DB clock, §6.2).
 *
 * Thin delegate over the JSON API path's `effectiveQuestionStatus` so the page and the API can
 * never disagree about a question's presented state (audit finding 1.1, PR #43). Inherits its
 * exact semantics, including: derivation is monotonic-FORWARD-only (an admin early-lock/open
 * with a future timestamp keeps its raw status, never reappears as an earlier state), and
 * `revealed`/`voided`/`draft` are real gates never reached by timestamp math alone.
 */
export function deriveEffectiveStatus(
  row: Pick<QuestionRow, 'status' | 'openAt' | 'lockAt'>,
  nowMsValue: number,
): QuestionPublic['status'] {
  // `effectiveQuestionStatus` only reads `status`/`openAt`/`lockAt`; the cast just widens the
  // declared parameter type, it does not touch any other column.
  return effectiveQuestionStatus(row as QuestionRow, new Date(nowMsValue));
}

/**
 * Assembles the §9.2 public question shape from raw rows by delegating to the JSON API's
 * serializer (effective status per §5.7, crowd-hiding per §9.3, and the §6.5/§6.7 publication
 * rule masking `outcome`/`revealed_at` until the question is GENUINELY revealed — raw status,
 * set only by `reveal:fire`). A settled-but-unrevealed daily therefore presents as plain
 * `locked` (countdown + lock-snapshot crowd, which is public at lock per §9.3); `void_reason`
 * passes through untouched (void reasons are public, §10.3 state table). `.parse`s the result
 * against the real contract schema before returning.
 */
export function toQuestionPublic(
  question: QuestionRow,
  market: MarketRow,
  nowMsValue: number,
): QuestionPublic {
  return questionPublicSchema.parse(
    serializeQuestionPublic(question, market, new Date(nowMsValue)),
  );
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
