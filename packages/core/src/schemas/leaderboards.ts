/**
 * Weekly category leaderboards (design doc §8.12, §9.2 GET /leaderboards/weekly).
 */
import { z } from 'zod';
import { MARKET_CATEGORY } from '../enums.js';
import { zDateOnly } from './common.js';
import { profileRefSchema } from './profiles.js';

export const leaderboardCategorySchema = z.enum([...MARKET_CATEGORY, 'overall'] as const);

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().min(1),
  profile: profileRefSchema,
  wins: z.number().int().nonnegative(),
  edge_sum: z.number(),
  picks: z.number().int().nonnegative(),
});

export const leaderboardBoardSchema = z.object({
  category: leaderboardCategorySchema,
  entries: z.array(leaderboardEntrySchema).max(100),
});

export const getWeeklyLeaderboardsRequestSchema = z.object({
  query: z.object({
    /** ISO week Monday (ET-keyed, §8.12); defaults to the in-progress week. */
    week_start: zDateOnly.optional(),
    category: leaderboardCategorySchema.optional(),
  }),
});

export const getWeeklyLeaderboardsResponseSchema = z.object({
  data: z.object({
    week_start: zDateOnly,
    /** The in-progress week is visible and labeled "live" (§8.12). */
    live: z.boolean(),
    boards: z.array(leaderboardBoardSchema),
  }),
});
