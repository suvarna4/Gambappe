/**
 * Threads: posts + reactions (design doc §9.2, §5.6).
 * Same thread shape at /questions/:slug/thread, /pairings/:id/thread, /duo-matches/:id/thread.
 */
import { z } from 'zod';
import { POST_MAX_CHARS, REACTION_SET } from '../config.js';
import { POST_STATUS, THREAD_CONTEXT } from '../enums.js';
import { zPairingId, zDuoMatchId, zPostId, zProfileId, zQuestionId } from '../ids.js';
import { paginationQuerySchema, zSlug, zTimestamp } from './common.js';

export const reactionEmojiSchema = z.enum(REACTION_SET);

export const postSchema = z.object({
  id: zPostId,
  context_kind: z.enum(THREAD_CONTEXT),
  context_id: z.string().uuid(),
  author: z.object({
    profile_id: zProfileId,
    handle: z.string(),
    slug: zSlug,
  }),
  body: z.string().max(POST_MAX_CHARS),
  status: z.enum(POST_STATUS),
  created_at: zTimestamp,
});

export const reactionCountSchema = z.object({
  emoji: reactionEmojiSchema,
  count: z.number().int().nonnegative(),
});

/** Posts + reaction counts, paginated (§9.2). */
export const threadResponseSchema = z.object({
  data: z.object({
    posts: z.array(postSchema),
    reaction_counts: z.array(reactionCountSchema),
  }),
  meta: z.object({ next_cursor: z.string().nullable() }),
});

// --- GET /questions/:slug/thread --------------------------------------------------------------

export const getQuestionThreadRequestSchema = z.object({
  params: z.object({ slug: zSlug }),
  query: paginationQuerySchema,
});
export const getQuestionThreadResponseSchema = threadResponseSchema;

// --- GET /pairings/:id/thread -----------------------------------------------------------------

export const getPairingThreadRequestSchema = z.object({
  params: z.object({ id: zPairingId }),
  query: paginationQuerySchema,
});
export const getPairingThreadResponseSchema = threadResponseSchema;

// --- GET /duo-matches/:id/thread --------------------------------------------------------------

export const getDuoMatchThreadRequestSchema = z.object({
  params: z.object({ id: zDuoMatchId }),
  query: paginationQuerySchema,
});
export const getDuoMatchThreadResponseSchema = threadResponseSchema;

// --- POST posts (claimed only; §9.2) ----------------------------------------------------------

export const createPostBodySchema = z
  .object({
    body: z.string().min(1).max(POST_MAX_CHARS),
  })
  .strict();

export const createQuestionPostRequestSchema = z.object({
  params: z.object({ id: zQuestionId }),
  body: createPostBodySchema,
});
export const createPairingPostRequestSchema = z.object({
  params: z.object({ id: zPairingId }),
  body: createPostBodySchema,
});
export const createDuoMatchPostRequestSchema = z.object({
  params: z.object({ id: zDuoMatchId }),
  body: createPostBodySchema,
});
export const createPostResponseSchema = z.object({ post: postSchema });

// --- POST /reactions (ghost+; toggle semantics — 2nd call removes; §9.2) ----------------------

export const createReactionBodySchema = z
  .object({
    context_kind: z.enum(THREAD_CONTEXT),
    context_id: z.string().uuid(),
    emoji: reactionEmojiSchema,
  })
  .strict();

export const createReactionRequestSchema = z.object({
  body: createReactionBodySchema,
});

export const createReactionResponseSchema = z.object({
  state: z.enum(['added', 'removed']),
});
