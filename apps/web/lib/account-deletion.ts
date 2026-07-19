/**
 * Claimed-account deletion orchestration (design doc §11.4; closes audit findings 3.1/3.2's
 * nemesis half). §11.4's deletion list includes "active pairing/duo → mid-week exit rule
 * (§5.7)", but the exit math needs `@receipts/engine` (scoring + Glicko), which `packages/db`
 * must not depend on (§4.2) — so `deleteAccount` (packages/db) cannot run the exits itself.
 * This wrapper is the web-side composition point, mirroring how `applyBlock`
 * (`@/lib/moderation.ts`) composes `insertBlock` + both exits in one transaction: nemesis
 * pairing exit, duo match exit, then the §11.4 deletion transaction, all atomic (the inner
 * calls become Postgres SAVEPOINTs, same pattern as `applyBlock`).
 *
 * Ordering matters: the exits queue §14.3's neutral "Your match this week ended early."
 * notification for BOTH sides of any concluded pairing/match, and `deleteAccount` then cancels
 * the deleting profile's queued notifications — so the surviving opponent is notified and the
 * erased profile never is. It also means a losing player cannot erase a loss by deleting their
 * account (§5.7's integrity rule; the same red-team hole `applyBlock` closes for blocking).
 */
import { deleteAccount, type Db, type DeleteAccountResult } from '@receipts/db';
import { applyDuoMidWindowExit } from './duo-match-lifecycle';
import { applyNemesisMidWeekExit } from './moderation';

/** §11.4 deletion for a claimed profile: §5.7 mid-week exits + `deleteAccount`, one transaction. */
export async function deleteClaimedAccount(
  db: Db,
  profileId: string,
  userId: string,
  at: Date,
): Promise<DeleteAccountResult> {
  return db.transaction(async (tx) => {
    await applyNemesisMidWeekExit(tx, profileId, at);
    await applyDuoMidWindowExit(tx, profileId, at);
    return deleteAccount(tx, profileId, userId, at);
  });
}
