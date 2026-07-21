/**
 * Server-side assembly of the `StackFeed` contract shape (packages/core/src/schemas/stack.ts,
 * journeys plan §4/§5 WS18-T1) directly from Postgres, for both the `GET /api/v1/stack` route
 * AND the `/` server render (WS18-T3 consumes the same function). One deck (D-J2): today's daily
 * headliner first, then open `kind='topic'` cards in the viewer's followed categories.
 *
 * Same delegation pattern as `question-view.ts` (read its header): a server component reads
 * `@receipts/db` directly rather than self-fetching the HTTP route (the repo's established SSR
 * pattern — no same-process round trip for the initial render), and serialization is DELEGATED to
 * `serialize-question.ts` via `question-view.ts`'s `toQuestionPublic` — the exact module the real
 * `GET /api/v1/questions/*` and `getTodayQuestionPublic` paths use — so the page path, the JSON
 * path, and the daily-question path can never drift. That sharing is load-bearing for the §6.5
 * publication rule (INV): a topic question that has settled but not been marked `revealed` on the
 * RAW status still presents masked, never leaking its outcome pre-reveal. On top of the shared
 * serializer this module adds only the flag gate, the followed-category resolution, and a final
 * `stackFeedSchema.parse` (any drift from the wire contract fails loudly rather than shipping a
 * malformed feed).
 *
 * `rival_sealed` (schema `.nullish()`): the flag lighting the headliner's `⚔ {handle} IS IN ·
 * SEALED` chip is populated only where cheaply available. Wiring the active-nemesis-pairing +
 * opponent-sealed-pick lookup is a heavier cross-repo join than this supply task carries, so every
 * card here is emitted with `rival_sealed: null` (a permitted `.nullish()` value); a later rivals
 * task (or WS18-T3's deck) fills it in without a contract change.
 */
import {
  nowMs as coreNowMs,
  isFlagEnabled,
  MARKET_CATEGORY,
  stackFeedSchema,
  type MarketCategory,
  type QuestionPublic,
  type StackFeed,
  type StackQuestion,
} from '@receipts/core';
import { getFollows, listOpenTopicQuestions, type Db } from '@receipts/db';
import { getTodayQuestionPublic, toQuestionPublic } from './question-view';

/** Journeys plan §4/§5: the topic deck is capped at 8, soonest-close first (the repo orders). */
export const STACK_TOPIC_LIMIT = 8;

export interface StackFeedOptions {
  /** The resolved viewer's profile id, or null for an anonymous/ghost-less viewer. */
  viewerProfileId?: string | null;
  /** Test-injectable clock; defaults to the core `nowMs()`. */
  nowMsValue?: number;
}

/**
 * A `QuestionPublic` lifted into the stack card shape. `rival_sealed` is left `null` (see the file
 * header) — additive `.nullish()` field, so consumers built before it's wired still validate.
 */
function toStackQuestion(question: QuestionPublic): StackQuestion {
  return { ...question, rival_sealed: null };
}

/**
 * The categories whose open topic questions the viewer sees: their followed set, or ALL categories
 * for a ghost / no-follows / anonymous viewer (journeys plan §4 default). An empty followed set is
 * treated as "no explicit preference" → all categories, never "show nothing".
 */
async function resolveViewerCategories(
  db: Db,
  viewerProfileId: string | null,
): Promise<MarketCategory[]> {
  if (viewerProfileId) {
    const follows = await getFollows(db, viewerProfileId);
    if (follows.length > 0) return follows;
  }
  return [...MARKET_CATEGORY];
}

/**
 * Assembles the §4 `StackFeed`: headliner = today's daily (via the shared `getTodayQuestionPublic`,
 * or null before the morning drop), topics = open `kind='topic'` questions in the viewer's
 * categories, soonest-close first, capped 8. Flag-gated: when `topic_markets` is off, `topics` is
 * always `[]` (the deck shows only the daily, INV-10). `.parse`s the result against the real
 * contract before returning.
 */
export async function assembleStackFeed(db: Db, opts: StackFeedOptions = {}): Promise<StackFeed> {
  const nowMsValue = opts.nowMsValue ?? coreNowMs();

  const headlinerPublic = await getTodayQuestionPublic(db, { nowMsValue });
  const headliner = headlinerPublic ? toStackQuestion(headlinerPublic) : null;

  let topics: StackQuestion[] = [];
  if (isFlagEnabled('topic_markets')) {
    const categories = await resolveViewerCategories(db, opts.viewerProfileId ?? null);
    const rows = await listOpenTopicQuestions(db, categories, STACK_TOPIC_LIMIT);
    topics = rows.map((row) =>
      toStackQuestion(toQuestionPublic(row.question, row.market, nowMsValue)),
    );
  }

  return stackFeedSchema.parse({ headliner, topics });
}
