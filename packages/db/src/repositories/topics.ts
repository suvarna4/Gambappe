/**
 * Topic-market repository (journeys plan §4/§5 WS16-T2): topic-question supply for the stack
 * feed + per-profile category follows. Thin DB primitives only; the feed-assembly + flag gating
 * live in `apps/web/lib/stack-feed.ts` (WS18-T1) and the follow API in WS18-T2.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { MarketCategory } from '@receipts/core';
import type { Db } from '../client.js';
import { markets, questions, topicFollows } from '../schema/index.js';
import type { MarketRow, QuestionRow } from './questions.js';

export type TopicFollowRow = typeof topicFollows.$inferSelect;
export type NewTopicFollowRow = typeof topicFollows.$inferInsert;

/** A topic question paired with its venue market — everything the stack serializer needs. */
export interface TopicQuestionRow {
  question: QuestionRow;
  market: MarketRow;
}

/**
 * Open `kind='topic'` questions whose market is in `categories`, soonest-close first, capped at
 * `limit`. Excludes locked/settled topics (status must be `open`). `categories` is the viewer's
 * followed set, or all categories for a ghost/no-follows viewer (the caller decides — an empty
 * list returns nothing, never "all").
 */
export async function listOpenTopicQuestions(
  db: Db,
  categories: readonly MarketCategory[],
  limit: number,
): Promise<TopicQuestionRow[]> {
  if (categories.length === 0 || limit <= 0) return [];
  return db
    .select({ question: questions, market: markets })
    .from(questions)
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .where(
      and(
        eq(questions.kind, 'topic'),
        eq(questions.status, 'open'),
        inArray(markets.category, [...categories]),
      ),
    )
    .orderBy(asc(markets.closeTime))
    .limit(limit);
}

/** The categories a profile follows (order unspecified). */
export async function getFollows(db: Db, profileId: string): Promise<MarketCategory[]> {
  const rows = await db
    .select({ category: topicFollows.category })
    .from(topicFollows)
    .where(eq(topicFollows.profileId, profileId));
  return rows.map((r) => r.category as MarketCategory);
}

/** Follow a category (idempotent — re-following is a no-op). */
export async function setFollow(
  db: Db,
  profileId: string,
  category: MarketCategory,
): Promise<void> {
  await db.insert(topicFollows).values({ profileId, category }).onConflictDoNothing();
}

/** Unfollow a category (idempotent — unfollowing a non-follow is a no-op). */
export async function clearFollow(
  db: Db,
  profileId: string,
  category: MarketCategory,
): Promise<void> {
  await db
    .delete(topicFollows)
    .where(and(eq(topicFollows.profileId, profileId), eq(topicFollows.category, category)));
}
