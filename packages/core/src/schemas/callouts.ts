/**
 * Call-out (challenge-link) API schemas (journeys plan §4/§5 WS20-T3, D-J5).
 * A call-out is a signed challenge link — also the referral loop. The challenger mints a link;
 * whoever opens and accepts it (claimed-only) becomes the opponent and a next-week nemesis
 * pairing is created. The token is stored hashed server-side; only the raw token rides the URL.
 */
import { z } from 'zod';
import { CALLOUT_STATUS } from '../enums.js';
import { zCalloutId, zPairingId, zProfileId } from '../ids.js';
import { zTimestamp } from './common.js';
import { profileRefSchema } from './profiles.js';

/**
 * The full call-out record as seen by its challenger (own callouts). `opponent` is null until
 * someone accepts; `pairing_id` is set once accepted. `.nullish()` on the additive fields per
 * the journeys plan's additive-only contract rule.
 */
export const calloutSchema = z.object({
  id: zCalloutId,
  status: z.enum(CALLOUT_STATUS),
  challenger: profileRefSchema,
  /** Null until accepted (journeys plan §4: `opponent_profile_id?`). */
  opponent: profileRefSchema.nullable(),
  /** 24h from creation (journeys plan §5 WS20-T3). */
  expires_at: zTimestamp,
  created_at: zTimestamp,
  /** Set once accepted → the created next-week nemesis pairing. */
  pairing_id: zPairingId.nullish(),
});

export type Callout = z.infer<typeof calloutSchema>;

/**
 * Public preview served to a link opener (`GET /api/v1/callouts/:token`): spectator-safe fields
 * only — challenger handle/record, status, expiry. Never leaks opponent or internal ids.
 */
export const calloutPreviewSchema = z.object({
  status: z.enum(CALLOUT_STATUS),
  challenger: profileRefSchema,
  expires_at: zTimestamp,
});

export type CalloutPreview = z.infer<typeof calloutPreviewSchema>;

// --- POST /api/v1/callouts (claimed-only) -----------------------------------------------------

/**
 * Optionally target a specific past rival (from nemesis history); omitted → an open challenge
 * link anyone can accept (the referral path). `.strict()` mirrors the other create-body schemas.
 */
export const createCalloutBodySchema = z
  .object({
    target_profile_id: zProfileId.nullish(),
  })
  .strict();

export const createCalloutRequestSchema = z.object({ body: createCalloutBodySchema });

/** Create response includes the shareable URL carrying the raw token (journeys plan §5 WS20-T3). */
export const calloutCreateResponseSchema = z.object({
  callout: calloutSchema,
  /** `{APP_URL}/rivals?callout={token}` — the only place the raw token is ever emitted. */
  share_url: z.string().url(),
});

export type CalloutCreateResponse = z.infer<typeof calloutCreateResponseSchema>;

// --- POST /api/v1/callouts/:token/accept | /decline, GET /api/v1/callouts/:token --------------

export const calloutTokenParamsSchema = z.object({ token: z.string().min(1) });

export const getCalloutPreviewRequestSchema = z.object({ params: calloutTokenParamsSchema });
export const getCalloutPreviewResponseSchema = calloutPreviewSchema;

export const acceptCalloutRequestSchema = z.object({ params: calloutTokenParamsSchema });
/** Accept mints the next-week pairing; `callout.pairing_id`/`opponent` are now populated. */
export const acceptCalloutResponseSchema = z.object({ callout: calloutSchema });

export const declineCalloutRequestSchema = z.object({ params: calloutTokenParamsSchema });
export const declineCalloutResponseSchema = z.object({ callout: calloutSchema });
