/**
 * Topic-follow API schemas (journeys plan §4/§5 WS18-T2):
 * `POST/DELETE /api/v1/topics/:category/follow` (ghost-allowed via the ghost cookie).
 * Category is the existing `MARKET_CATEGORY` — topics are followed by market category, not by
 * question, so a follow is a small `(profile, category)` fact.
 */
import { z } from 'zod';
import { MARKET_CATEGORY } from '../enums.js';

/** One category-follow state as returned after a toggle. */
export const topicFollowSchema = z.object({
  category: z.enum(MARKET_CATEGORY),
  /** True after POST (followed), false after DELETE (unfollowed). */
  following: z.boolean(),
});

export type TopicFollow = z.infer<typeof topicFollowSchema>;

export const topicFollowParamsSchema = z.object({
  category: z.enum(MARKET_CATEGORY),
});

// --- POST/DELETE /api/v1/topics/:category/follow ----------------------------------------------

export const setTopicFollowRequestSchema = z.object({
  params: topicFollowParamsSchema,
});
export const setTopicFollowResponseSchema = topicFollowSchema;
