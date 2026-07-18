/**
 * `users` (Auth.js-managed) repository helpers (WS2 additions — auth-only table, §5.2).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { users } from '../schema/index.js';

export type UserRow = typeof users.$inferSelect;

export async function getUserById(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/** INV-9: stamps `users.age_attested_at` (idempotent — only meaningful the first time). */
export async function setUserAgeAttested(db: Db, id: string, at: Date): Promise<void> {
  await db.update(users).set({ ageAttestedAt: at, updatedAt: at }).where(eq(users.id, id));
}

/** Hard-delete the Auth.js user row (§11.4 — `accounts`/`sessions` cascade via FK onDelete). */
export async function deleteUserById(db: Db, id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}
