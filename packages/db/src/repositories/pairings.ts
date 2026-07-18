/**
 * Nemesis pairing repository helpers (design doc §5.5). Additive-only, WS8-T1 scope: the
 * public matchup page (`GET /pairings/:id`, §9.2) and its `/api/og/matchup/:id` OG card
 * (§10.5) both need a pairing-by-id lookup plus its two profiles' handles/slugs; the full
 * `/api/v1/pairings/*` route surface (narration line, scoreboard rows) is WS3/WS5 scope and
 * lands separately.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { nemesisPairings, profiles } from '../schema/index.js';
// `NemesisPairingRow` already lives in moderation.ts (WS11-T3) and is re-exported from
// `index.ts` via that module — imported (not re-declared/re-exported) here to avoid an
// ambiguous duplicate `export *` of the same name from two repository files.
import type { NemesisPairingRow } from './moderation.js';

export type NewNemesisPairingRow = typeof nemesisPairings.$inferInsert;

export async function insertNemesisPairing(
  db: Db,
  row: NewNemesisPairingRow,
): Promise<NemesisPairingRow> {
  const [inserted] = await db.insert(nemesisPairings).values(row).returning();
  if (!inserted) throw new Error('insertNemesisPairing: no row returned');
  return inserted;
}

export async function getPairingById(db: Db, id: string): Promise<NemesisPairingRow | null> {
  const [row] = await db.select().from(nemesisPairings).where(eq(nemesisPairings.id, id)).limit(1);
  return row ?? null;
}

export interface PairingWithProfiles {
  pairing: NemesisPairingRow;
  profileA: typeof profiles.$inferSelect;
  profileB: typeof profiles.$inferSelect;
}

/** Pairing + both profile rows in one round trip — what every public matchup surface needs. */
export async function getPairingWithProfiles(
  db: Db,
  id: string,
): Promise<PairingWithProfiles | null> {
  const pairing = await getPairingById(db, id);
  if (!pairing) return null;
  const [profileA, profileB] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.id, pairing.profileAId)).limit(1),
    db.select().from(profiles).where(eq(profiles.id, pairing.profileBId)).limit(1),
  ]);
  if (!profileA[0] || !profileB[0]) return null;
  return { pairing, profileA: profileA[0], profileB: profileB[0] };
}
