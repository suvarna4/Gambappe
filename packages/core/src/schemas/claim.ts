/**
 * Claim API schemas (design doc §6.3, §9.2 POST /claim).
 */
import { z } from 'zod';
import { meProfileSchema } from './me.js';

/** Which §6.3 case ran (analytics: PRD conversion metric). */
export const CLAIM_CASES = ['A', 'B', 'C', 'D'] as const;

export const claimBodySchema = z
  .object({
    /** Required (literal true) when `users.age_attested_at` is null (INV-9). */
    age_attested: z.literal(true).optional(),
    /**
     * Shared-device guard (§6.3): "This isn't me" — caller explicitly disclaims the ghost
     * cookie on the request. Ghost cookie is cleared and the flow proceeds as case B/D instead
     * of A/C. Additive field (WS2-T3); no other workstream depends on claim.ts.
     */
    not_me: z.literal(true).optional(),
  })
  .strict();

export const claimRequestSchema = z.object({ body: claimBodySchema });

export const claimResponseSchema = z.object({
  profile: meProfileSchema,
  case: z.enum(CLAIM_CASES),
});
