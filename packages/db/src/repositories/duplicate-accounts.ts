/**
 * Duplicate-account lookup (§14.4, WS11-T4): "same verified email family... blocked at
 * auth." The actual Auth.js signIn-callback wiring is WS2's scope (not yet merged — apps/web
 * has no Auth.js config on main today), so this is the standalone, testable half: given a
 * candidate email, does any existing `users` row's email normalize to the same family?
 *
 * O(n) over all users with an email — acceptable for a "best-effort only" (§14.4) check;
 * `users.email` is stored as typed, not pre-normalized, so there's no indexed shortcut yet. A
 * `normalized_email` column + unique index is the natural follow-up if signup volume ever
 * makes a full scan too slow — not built here since it'd mean altering the same `users`
 * table WS2's unmerged PR is also extending, and this task doesn't need it to be correct.
 */
import { isNotNull } from 'drizzle-orm';
import { normalizeEmailForDuplicateCheck } from '@receipts/core';
import type { Db } from '../client.js';
import { users } from '../schema/index.js';

export interface DuplicateAccountMatch {
  userId: string;
  email: string;
}

export async function findDuplicateAccountByEmail(
  db: Db,
  candidateEmail: string,
): Promise<DuplicateAccountMatch | null> {
  const candidateNormalized = normalizeEmailForDuplicateCheck(candidateEmail);
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(isNotNull(users.email));

  for (const row of rows) {
    if (row.email && normalizeEmailForDuplicateCheck(row.email) === candidateNormalized) {
      return { userId: row.id, email: row.email };
    }
  }
  return null;
}
