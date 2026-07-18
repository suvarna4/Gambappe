/**
 * Minimal `nemesis_pairings` read helper (design doc §5.5, §7.6 `nemesis:lastday`, WS9-T3).
 *
 * SPEC-GAP(WS9-T3): WS5 (nemesis matchmaking/scoring) hasn't landed yet, so no workstream in
 * this wave populates `nemesis_pairings`. This file intentionally stays a thin, generic read —
 * "list currently active pairings" — rather than anticipating WS5's scoring/verdict data model.
 * WS5-T1..T3 own the write paths and the richer query surface `nemesis:lastday`'s real
 * "close score" beat-selection logic will eventually need (§13.3 `nemesis_last_day`).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { nemesisPairings } from '../schema/index.js';

export interface ActiveNemesisPairing {
  id: string;
  weekStart: string;
  profileAId: string;
  profileBId: string;
  scoreA: number;
  scoreB: number;
}

/** Pairings currently `status = 'active'` — the mock-start query for `nemesis:lastday` (§7.6). */
export async function listActiveNemesisPairings(db: Db): Promise<ActiveNemesisPairing[]> {
  const rows = await db
    .select({
      id: nemesisPairings.id,
      weekStart: nemesisPairings.weekStart,
      profileAId: nemesisPairings.profileAId,
      profileBId: nemesisPairings.profileBId,
      scoreA: nemesisPairings.scoreA,
      scoreB: nemesisPairings.scoreB,
    })
    .from(nemesisPairings)
    .where(eq(nemesisPairings.status, 'active'));
  return rows;
}
