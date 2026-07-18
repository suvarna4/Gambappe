/**
 * `GET /me` (design doc §9.2 "Own profile incl. settings, eligibility progress (picks toward
 * 5/10), claim state"; §10.2 "resolves identity via GET /me"). The schema
 * (`getMeResponseSchema`) already exists in `@receipts/core` — no §19 task lists a concrete AC
 * for the route handler itself, but WS7-T5's shared-device guard (§6.3: "the claim UI first
 * shows the ghost's handle and record") structurally depends on it (need the ghost's handle +
 * streak + pick count client-side, pre-sign-in, to render the "That you?" confirmation card),
 * and §10.2's spectator-page architecture names `GET /me` as the identity-resolution call every
 * viewer strip makes. SPEC-GAP(WS7-T5): implementing the minimal route here since it's a pure
 * read with an already-pinned contract and nothing else claims it; flagged in the PR description.
 *
 * Kept independent of the HTTP layer (takes `Db` + an already-resolved `Identity`, no
 * `Request`/`NextResponse`) so it's directly unit/integration-testable, mirroring
 * `claim-flow.ts`'s split from `claim/route.ts`.
 */
import {
  ApiError,
  DUO_MIN_PICKS,
  NEMESIS_MIN_PICKS,
  profileSettingsSchema,
  type getMeResponseSchema,
} from '@receipts/core';
import { getFingerprintRow, type Db } from '@receipts/db';
import type { z } from 'zod';
import type { Identity } from './identity';
import { toMeProfile } from './serialize-profile';

export type GetMeResponse = z.infer<typeof getMeResponseSchema>;

export async function buildMeResponse(db: Db, identity: Identity): Promise<GetMeResponse> {
  if (identity.kind === 'anonymous') {
    // "ghost+" access (§9.2 API table) — a ghost cookie or a session is required.
    throw new ApiError('UNAUTHENTICATED', 'sign-in or a ghost identity is required');
  }

  const { profile } = identity;
  const fingerprint = await getFingerprintRow(db, profile.id);
  const gradedPicks = fingerprint?.resolvedPickCount ?? 0;
  const settings = profileSettingsSchema.parse(profile.settings ?? {});

  return {
    profile: toMeProfile(profile),
    settings,
    eligibility: {
      graded_picks: gradedPicks,
      nemesis_required: NEMESIS_MIN_PICKS,
      duo_required: DUO_MIN_PICKS,
      nemesis_eligible: gradedPicks >= NEMESIS_MIN_PICKS,
      duo_eligible: gradedPicks >= DUO_MIN_PICKS,
    },
    claim: { claimed: identity.kind === 'claimed' },
  };
}
