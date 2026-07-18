/**
 * Profile repository helpers (WS0-T3). Business flows (mint/claim/merge) are WS2 scope;
 * these are the shared primitives.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { profiles } from '../schema/index.js';

export type ProfileRow = typeof profiles.$inferSelect;
export type NewProfileRow = typeof profiles.$inferInsert;

export async function insertProfile(db: Db, row: NewProfileRow): Promise<ProfileRow> {
  const [inserted] = await db.insert(profiles).values(row).returning();
  if (!inserted) throw new Error('insertProfile: no row returned');
  return inserted;
}

export async function getProfileById(db: Db, id: string): Promise<ProfileRow | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  return row ?? null;
}

export async function getProfileBySlug(db: Db, slug: string): Promise<ProfileRow | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.slug, slug)).limit(1);
  return row ?? null;
}
