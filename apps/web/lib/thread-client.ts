/**
 * Client-side (browser) typed fetch wrappers for the question thread (§9.2, §10.3 "revealed"
 * state, WS7-T8). Mirrors `pick-client.ts`'s `request()` envelope-unwrap/error-mapping pattern
 * (imported from there rather than duplicated) — unlike that file's original mock-start posture,
 * every route called here (`GET .../thread`, `POST .../posts`, `POST /reactions`) is real and
 * merged in this same PR.
 */
import {
  createPostBodySchema,
  createPostResponseSchema,
  createReactionBodySchema,
  createReactionResponseSchema,
  getQuestionThreadResponseSchema,
  type ThreadContext,
} from '@receipts/core';
import type { z } from 'zod';
import { request, type ApiResult } from './pick-client';

type CreatePostBody = z.infer<typeof createPostBodySchema>;
type CreatePostResponse = z.infer<typeof createPostResponseSchema>;
type CreateReactionBody = z.infer<typeof createReactionBodySchema>;
type CreateReactionResponse = z.infer<typeof createReactionResponseSchema>;
/** The full double-nested shape (§9.1 list envelope inside the §9.1 success envelope — same
 * convention as `GET /profiles/:slug/picks`, see that route's own comment for why). */
type QuestionThreadResponse = z.infer<typeof getQuestionThreadResponseSchema>;

/** `GET /api/v1/questions/:slug/thread` (§9.2, public). */
export function fetchQuestionThread(
  slug: string,
  cursor?: string | null,
): Promise<ApiResult<QuestionThreadResponse>> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request(
    `/api/v1/questions/${encodeURIComponent(slug)}/thread${qs}`,
    { method: 'GET' },
    getQuestionThreadResponseSchema,
  );
}

/** `POST /api/v1/questions/:id/posts` (§9.2, claimed only). */
export async function createQuestionPost(
  questionId: string,
  body: CreatePostBody,
): Promise<ApiResult<CreatePostResponse>> {
  const parsedBody = createPostBodySchema.parse(body);
  return request(
    `/api/v1/questions/${encodeURIComponent(questionId)}/posts`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsedBody),
    },
    createPostResponseSchema,
  );
}

/** `POST /api/v1/reactions` (§9.2, ghost+ — toggle semantics, 2nd identical call removes). */
export async function submitReaction(
  contextKind: ThreadContext,
  contextId: string,
  emoji: CreateReactionBody['emoji'],
): Promise<ApiResult<CreateReactionResponse>> {
  const parsedBody = createReactionBodySchema.parse({
    context_kind: contextKind,
    context_id: contextId,
    emoji,
  });
  return request(
    '/api/v1/reactions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsedBody),
    },
    createReactionResponseSchema,
  );
}
