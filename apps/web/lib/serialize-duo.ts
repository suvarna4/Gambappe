/**
 * `DuoRow`/`DuoMatchRow` → `duoPublicSchema`/`duoMatchPublicSchema` (design doc §9.2
 * `GET /duo/current`, WS6-T1). Public duo page serialization (`GET /duos/:id`) is WS6-T4 scope,
 * but this same shape is what it will need too.
 */
import type { z } from 'zod';
import { getProfileById, type Db, type ProfileRow } from '@receipts/db';
import type { duoMatchPublicSchema, duoPublicSchema } from '@receipts/core';
import type { DuoMatchRow, DuoRow } from './duo-queue';

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
