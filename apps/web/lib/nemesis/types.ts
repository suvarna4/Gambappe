/**
 * Type aliases for the nemesis UI (WS7-T6, design doc §10.1 route table + §19.3 WBS row).
 *
 * These are `z.infer` aliases over the REAL, already-merged API contract in `@receipts/core`
 * (`packages/core/src/schemas/pairings.ts`, shipped by WS0-T2) — not invented shapes. WS5-T4
 * ("Matchup + history APIs", §9.2/§9.3) owns the actual route handlers that will one day
 * produce values of these types from Postgres; until that lands, `mock-api.ts` in this
 * directory produces them from an in-memory fixture, parsed through the same zod schemas so
 * the mock cannot silently drift from the documented response shape.
 *
 * SPEC-GAP(WS7-T6): `pairingPublicSchema.a`/`.b` are `profileRefSchema` (handle + slug only,
 * per §9.2 "both handles") — no rating field. This UI wants to show each side's Glicko rating
 * (per the task brief), so it separately composes `GET /profiles/:slug` (also unbuilt; also
 * mocked here) for each side, exactly as a real client would have to. If WS5-T4 or a later
 * contract-change PR decides to inline rating into the pairing payload instead, this
 * composition step goes away but the UI's data shape (`PairingSide`, below) stays the same.
 */
import type { z } from 'zod';
import type {
  pairingPublicSchema,
  pairingScoreboardRowSchema,
  nemesisHistoryEntrySchema,
  rematchRequestSchema,
  profileRefSchema,
  RematchStatus,
} from '@receipts/core';

export type PairingPublic = z.infer<typeof pairingPublicSchema>;
export type PairingScoreboardRow = z.infer<typeof pairingScoreboardRowSchema>;
export type NemesisHistoryEntry = z.infer<typeof nemesisHistoryEntrySchema>;
export type RematchRequest = z.infer<typeof rematchRequestSchema>;
export type ProfileRef = z.infer<typeof profileRefSchema>;
export type { RematchStatus };

/** A side's rating summary, sourced from the (also mocked) `GET /profiles/:slug`. */
export interface RatingSummary {
  glicko_rating: number;
  glicko_rd: number;
  games_count: number;
  accuracy_percentile: number | null;
}

/**
 * `ProfileRef` + rating — what the matchup header actually renders per side. Deliberately
 * NOT `extends ProfileRef`: `profile_id` here is a plain `string`, not the branded
 * `ProfileId` — this composed shape never round-trips through a real zod schema (there is
 * no `pairingSideSchema` in the §9.2 contract; it's this UI's own composition of
 * `pairingPublicSchema`'s `ProfileRef` + a rating subset of `profilePublicSchema`), so it
 * has nothing to brand against.
 */
export interface PairingSide {
  profile_id: string;
  handle: string;
  slug: string;
  rating: RatingSummary | null;
}
