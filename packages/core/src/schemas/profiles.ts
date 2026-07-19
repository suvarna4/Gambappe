/**
 * Public profile API schemas (design doc §9.2 GET /profiles/:slug, /profiles/:slug/picks).
 * Profiles are addressed by URL slug (§6.1.2 — handles contain `#`/space).
 */
import { z } from 'zod';
import { MARKET_CATEGORY, PROFILE_KIND } from '../enums.js';
import { zProfileId } from '../ids.js';
import { listEnvelopeSchema, paginationQuerySchema, zSlug, zTimestamp } from './common.js';
import { pickPublicSchema } from './picks.js';

/** Minimal public reference to a profile (embedded in pairings, duos, leaderboards...). */
export const profileRefSchema = z.object({
  profile_id: zProfileId,
  handle: z.string(),
  slug: zSlug,
});

/** Fingerprint style summary as publicly displayed (never raw internals). */
export const fingerprintSummarySchema = z.object({
  resolved_pick_count: z.number().int().nonnegative(),
  chalk: z.number().min(-1).max(1),
  contrarian: z.number().min(-1).max(1),
  timing: z.number().min(-1).max(1),
  category_shares: z.record(z.enum(MARKET_CATEGORY), z.number()),
});

/**
 * Verified-wallet public block (§12.4 exhaustive display allowlist): badge, first_seen month,
 * position count, style descriptors. NEVER size buckets, sizes, or P&L (INV-7).
 * `address` present only when `settings.show_wallet_address` (§12.5).
 */
export const walletBadgeSchema = z.object({
  verified: z.boolean(),
  first_seen: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  position_count: z.number().int().nonnegative().nullable(),
  address: z.string().nullable(),
});

export const profilePublicSchema = z.object({
  profile_id: zProfileId,
  handle: z.string(),
  slug: zSlug,
  kind: z.enum(PROFILE_KIND),
  created_at: zTimestamp,
  /** Participation streak (DD-3). */
  streak: z.object({
    current: z.number().int().nonnegative(),
    best: z.number().int().nonnegative(),
  }),
  win_streak: z.object({
    current: z.number().int().nonnegative(),
    best: z.number().int().nonnegative(),
  }),
  rating: z
    .object({
      glicko_rating: z.number(),
      glicko_rd: z.number(),
      games_count: z.number().int().nonnegative(),
      /** Display-only nightly percentile; null under 10 graded picks (§5.4). */
      accuracy_percentile: z.number().min(0).max(100).nullable(),
    })
    .nullable(),
  fingerprint: fingerprintSummarySchema.nullable(),
  badges: z.array(z.string()),
  wallet: walletBadgeSchema.nullable(),
  nemesis_summary: z
    .object({
      wins: z.number().int().nonnegative(),
      losses: z.number().int().nonnegative(),
      draws: z.number().int().nonnegative(),
    })
    .nullable(),
  /**
   * The graveyard shelf (SW9-T3 contract-change; `docs/plans/obituary-handoff.md` §4):
   * completed (broken) participation runs with length ≥ `OBITUARY_MIN_STREAK`, as bare run
   * LENGTHS only — newest-first, capped at `GRAVEYARD_RIP_CAP` — plus the lifetime public
   * "called it" count shown beside the graves.
   *
   * Privacy pin (do NOT extend): no per-run dates and no question slugs, ever — either would
   * make participation on specific dates publicly inferable even where the picks themselves
   * are `is_public = false` (§9.2 exposes only public picks); bare lengths leak nothing beyond
   * the already-public streak numbers. Null when there is nothing to shelve (no qualifying
   * dead runs and no called-it wins) — the profile page then renders no shelf at all
   * (SW4-T3 empty-state AC).
   */
  graveyard: z
    .object({
      rip: z.array(z.number().int().positive()),
      called_it_count: z.number().int().nonnegative(),
    })
    .nullable(),
  /**
   * Recent picks (paginated, `is_public` only). Picks on graded-but-unrevealed dailies present
   * as `pending` (§6.5 publication rule); public `picked_at` is minute-truncated (§9.2).
   */
  recent_picks: listEnvelopeSchema(pickPublicSchema),
});

// --- GET /profiles/:slug ----------------------------------------------------------------------

export const getProfileRequestSchema = z.object({
  params: z.object({ slug: zSlug }),
});
export const getProfileResponseSchema = profilePublicSchema;

// --- GET /profiles/:slug/picks (full public pick log — receipts culture, INV-6) ---------------

export const getProfilePicksRequestSchema = z.object({
  params: z.object({ slug: zSlug }),
  query: paginationQuerySchema,
});
export const getProfilePicksResponseSchema = listEnvelopeSchema(pickPublicSchema);
