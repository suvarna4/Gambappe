/**
 * Duo repository helpers (design doc §5.5). Additive-only, WS8-T1 scope: the public duo page
 * (`GET /duos/:id`, §9.2) and its `/api/og/duo/:id` OG card (§10.5) both need a duo-by-id
 * lookup plus its two partner profiles' handles/slugs; the full `/api/v1/duos/*` route
 * surface (match history, ladder) is WS3/WS5 scope and lands separately.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { duos, profiles } from '../schema/index.js';

export type DuoRow = typeof duos.$inferSelect;
export type NewDuoRow = typeof duos.$inferInsert;

export async function insertDuo(db: Db, row: NewDuoRow): Promise<DuoRow> {
  const [inserted] = await db.insert(duos).values(row).returning();
  if (!inserted) throw new Error('insertDuo: no row returned');
  return inserted;
}

export async function getDuoById(db: Db, id: string): Promise<DuoRow | null> {
  const [row] = await db.select().from(duos).where(eq(duos.id, id)).limit(1);
  return row ?? null;
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
