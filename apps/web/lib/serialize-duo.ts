/**
 * `DuoRow`/`DuoMatchRow` → `duoPublicSchema`/`duoMatchPublicSchema` (design doc §9.2
 * `GET /duo/current`, WS6-T1). Public duo page serialization (`GET /duos/:id`, WS6-T4) is added
 * at the bottom of this file — same shapes, one more assembly step (+ match history).
 */
import type { z } from 'zod';
import { getDuoWithProfiles, getProfileById, listDuoMatchHistory, type Db, type ProfileRow } from '@receipts/db';
import type { duoMatchPublicSchema, duoPublicSchema, getDuoResponseSchema } from '@receipts/core';
import type { DuoMatchRow, DuoRow } from './duo-queue';

/** Default cap on `GET /duos/:id`'s `match_history` array (§9.2 — a plain array, not a paginated
 * list; a duo plays at most one match per window, §8.10, so MVP history is naturally small).
 * Appendix D pins no specific number here — SPEC-GAP(ws6-t4), same class of gap as
 * `profile-page.ts`'s `PROFILE_PICKS_DEFAULT_LIMIT`. */
export const DUO_MATCH_HISTORY_LIMIT = 50;

function profileRef(p: ProfileRow): z.infer<typeof duoPublicSchema>['partners'][number] {
  return {
    profile_id: p.id as z.infer<typeof duoPublicSchema>['partners'][number]['profile_id'],
    handle: p.handle,
    slug: p.slug,
  };
}

export async function toDuoPublic(db: Db, duo: DuoRow): Promise<z.infer<typeof duoPublicSchema>> {
  const [a, b] = await Promise.all([
    getProfileById(db, duo.profileAId),
    getProfileById(db, duo.profileBId),
  ]);
  if (!a || !b) {
    // Shouldn't happen (profiles are never hard-deleted, §11.4) but keeps this function total.
    throw new Error(`toDuoPublic: missing partner profile for duo ${duo.id}`);
  }
  return {
    id: duo.id as z.infer<typeof duoPublicSchema>['id'],
    status: duo.status,
    tier: duo.tier,
    partners: [profileRef(a), profileRef(b)],
    rating: { glicko_rating: duo.glickoRating, glicko_rd: duo.glickoRd },
    matches_played: duo.matchesPlayed,
    joint_hit_rate: duo.jointHitRate,
    synergy: duo.synergy,
  };
}

export function toDuoMatchPublic(match: DuoMatchRow): z.infer<typeof duoMatchPublicSchema> {
  return {
    id: match.id as z.infer<typeof duoMatchPublicSchema>['id'],
    duo_a_id: match.duoAId as z.infer<typeof duoMatchPublicSchema>['duo_a_id'],
    duo_b_id: match.duoBId as z.infer<typeof duoMatchPublicSchema>['duo_b_id'],
    window_start: match.windowStart,
    window_end: match.windowEnd,
    status: match.status,
    score: { a: match.scoreA, b: match.scoreB },
    winner_duo_id: match.winnerDuoId as z.infer<typeof duoMatchPublicSchema>['winner_duo_id'],
  };
}

// --- WS6-T4: public duo page (`GET /duos/:id`, §9.2) --------------------------------------------

/**
 * Assembles the whole `GET /duos/:id` response: the duo itself (§9.2 "partners, tier, rating,
 * chemistry") plus `match_history` (its past `completed`/`cancelled` matches — see
 * `duo-matches.ts`'s `listDuoMatchHistory` header for why the live match is excluded here). A
 * `disbanded` duo still resolves (public, `auth: none`, §9.2 doesn't call for hiding it — its
 * page is exactly what "disband, partner notified" leaves behind for both sides and any
 * spectator to look back on, matching the receipts-culture INV-6 "artifacts persist" ethos).
 * `null` for an unknown duo id (route maps that to 404).
 */
export async function getDuoPublicPage(
  db: Db,
  duoId: string,
  historyLimit: number,
): Promise<z.infer<typeof getDuoResponseSchema> | null> {
  const found = await getDuoWithProfiles(db, duoId);
  if (!found) return null;

  const [duoPublic, history] = await Promise.all([
    toDuoPublic(db, found.duo),
    listDuoMatchHistory(db, duoId, historyLimit),
  ]);

  return { duo: duoPublic, match_history: history.map(toDuoMatchPublic) };
}
