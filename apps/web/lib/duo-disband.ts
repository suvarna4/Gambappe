/**
 * `POST /api/v1/duos/:id/disband` (design doc §8.5 "disband itself is always unilateral", §9.2
 * `POST /duos/:id/disband`, WS6-T4). "Member only; partner notified" — there is no mutual-accept
 * step (that WOULD be a genuine consent flow, like `rematch-requests`' accept/decline, §9.2), so
 * the "consent" this task's AC refers to is: any single member may act unilaterally, the OTHER
 * member never has to approve, and the only thing owed to them is a notification after the fact.
 *
 * Mirrors `apps/web/lib/moderation.ts`'s `applyBlock` transaction shape, with one ordering
 * requirement `applyBlock` didn't have to think about: `applyDuoMidWindowExit`
 * (`duo-match-lifecycle.ts`, WS6-T2) looks up the caller's ACTIVE duo via
 * `getActiveDuoForProfile`, which filters on `status = 'active'`. If this function flipped the
 * duo to `disbanded` first, that lookup would silently find nothing and skip concluding/
 * cancelling a live match — corrupting duo ratings for both sides of that match (exactly the
 * "erase a losing week" hole §5.7/§14.3 exist to close, just via a different door than blocking).
 * So the order here is: lock → validate → conclude the live match (duo still `active`) → THEN
 * disband → THEN notify.
 */
import { ApiError } from '@receipts/core';
import { disbandDuo, lockDuoForUpdate, sendNotification, type Db } from '@receipts/db';
import { applyDuoMidWindowExit } from './duo-match-lifecycle';

export interface DisbandDuoResult {
  disbanded: true;
}

export async function disbandDuoForMember(db: Db, duoId: string, actorProfileId: string, at: Date): Promise<DisbandDuoResult> {
  return db.transaction(async (tx) => {
    const locked = await lockDuoForUpdate(tx, duoId);
    if (!locked) throw new ApiError('NOT_FOUND', 'duo not found');

    if (locked.profileAId !== actorProfileId && locked.profileBId !== actorProfileId) {
      throw new ApiError('FORBIDDEN', 'only a member of this duo may disband it');
    }

    if (locked.status !== 'active') {
      // SPEC-GAP(ws6-t4): Appendix C has no dedicated "already disbanded"/state-conflict code
      // for this family (only `ALREADY_PICKED`/`CLAIM_CONFLICT`, both narrowly named for their
      // own flows). Reusing `NOT_FOUND` mirrors `duo-queue.ts`'s `leaveDuoQueue` precedent —
      // "the action no longer applies" — rather than inventing a code without a
      // packages/core contract-change PR.
      throw new ApiError('NOT_FOUND', 'this duo is already disbanded');
    }

    // Conclude/cancel any live match FIRST — see file header for why order matters.
    await applyDuoMidWindowExit(tx, actorProfileId, at);

    await disbandDuo(tx, duoId, at);

    const partnerId = locked.profileAId === actorProfileId ? locked.profileBId : locked.profileAId;
    // SPEC-GAP(ws6-t4): kind `duo_disbanded` is a placeholder mirroring `duo-match-lifecycle.ts`'s
    // own `duo_match_ended_early` SPEC-GAP — §13.3's beat catalog isn't in this task's reading
    // scope; WS9-T3 should confirm/rename against the real catalog. `dedupeKey` makes a retried
    // request (network hiccup, double-tap) a safe no-op rather than a duplicate notification.
    await sendNotification(tx, partnerId, 'duo_disbanded', { duo_id: duoId }, 'email', `duo_disbanded:${duoId}`, at);

    return { disbanded: true as const };
  });
}
