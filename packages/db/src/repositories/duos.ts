/**
 * Duo repository helpers (design doc §5.5). Additive-only, WS8-T1 scope: the public duo page
 * (`GET /duos/:id`, §9.2) and its `/api/og/duo/:id` OG card (§10.5) both need a duo-by-id
 * lookup plus its two partner profiles' handles/slugs; the full `/api/v1/duos/*` route
 * surface (match history, ladder) is WS3/WS5 scope and lands separately.
 *
 * `DuoRow`/`getDuoById` are reused from `./ratings.js` (WS4-T7), which independently built
 * the same lookup for its own batch job, rather than redeclared here — both files are
 * re-exported `export *` from `index.ts`, so a second declaration of the same name would be
 * an ambiguous-export TS error. Not re-exported from this file either (same reason); callers
 * needing `DuoRow`/`getDuoById` get them from `@receipts/db` via `ratings.js`'s export.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { duos, profiles } from '../schema/index.js';
import { getDuoById, type DuoRow } from './ratings.js';

export type NewDuoRow = typeof duos.$inferInsert;

export async function insertDuo(db: Db, row: NewDuoRow): Promise<DuoRow> {
  const [inserted] = await db.insert(duos).values(row).returning();
  if (!inserted) throw new Error('insertDuo: no row returned');
  return inserted;
}

export interface DuoWithProfiles {
  duo: DuoRow;
  profileA: typeof profiles.$inferSelect;
  profileB: typeof profiles.$inferSelect;
}

export async function getDuoWithProfiles(db: Db, id: string): Promise<DuoWithProfiles | null> {
  const duo = await getDuoById(db, id);
  if (!duo) return null;
  const [profileA, profileB] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.id, duo.profileAId)).limit(1),
    db.select().from(profiles).where(eq(profiles.id, duo.profileBId)).limit(1),
  ]);
  if (!profileA[0] || !profileB[0]) return null;
  return { duo, profileA: profileA[0], profileB: profileB[0] };
}
