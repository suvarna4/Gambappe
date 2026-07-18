/**
 * Internal worker→web schemas (design doc §9.2 POST /internal/revalidate).
 * Bearer `INTERNAL_API_SECRET` (constant-time compare); hardened: allowlisted route patterns,
 * max REVALIDATE_MAX_PATHS paths/call, RL_REVALIDATE_MIN global rate limit.
 */
import { z } from 'zod';
import { REVALIDATE_MAX_PATHS } from '../config.js';

export const revalidateBodySchema = z
  .object({
    paths: z.array(z.string().min(1)).min(1).max(REVALIDATE_MAX_PATHS),
  })
  .strict();

export const revalidateRequestSchema = z.object({ body: revalidateBodySchema });

export const revalidateResponseSchema = z.object({
  revalidated: z.array(z.string()),
  /** Paths rejected by the allowlist (call still succeeds for allowed paths). */
  rejected: z.array(z.string()),
});
