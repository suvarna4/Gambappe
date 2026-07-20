/**
 * Pairing (nemesis matchup) preset-stamp reaction write path (wiring-gaps doc §4 SW10-T4,
 * swipe-ux-plan §2.9 SW5-T4). Deliberately separate from `apps/web/lib/threads.ts`'s generic
 * `POST /reactions` orchestration (see that file's own scope note) — pairing reactions have a
 * different auth posture (claimed-only, not `ghost+`), different uniqueness (one per player per
 * ET calendar day, not per emoji), and different write semantics (replace, not toggle).
 *
 * Server-side enforcement here is intentionally first-class, not delegated: `POST /reactions`
 * had no block-check at all before this task (`lib/moderation.ts`'s `applyBlock` only cancels
 * pairing/duo state — it never touches reactions), and the route's base auth is `ghost+`, which
 * would otherwise let a ghost post a pairing reaction with nothing stopping it but the client's
 * claim-prompt nudge (UX only, not enforcement — a direct POST bypassing the UI must still
 * fail). Every reject path below throws `ApiError('FORBIDDEN', ...)`, mirroring
 * `duo-disband.ts`/`nemesis/rematch.ts`'s existing convention for "wrong actor for this
 * resource" rejections in this codebase.
 */
import { ApiError, etDateString, PAIRING_REACTION_SET, type PairingReactionEmoji } from '@receipts/core';
import { areProfilesBlocked, getPairingById, upsertPairingReaction, type Db } from '@receipts/db';

export interface SubmitPairingReactionInput {
  pairingId: string;
  profileId: string;
  /** The caller's resolved `profiles.kind` — passed in rather than re-fetched, since the route
   * already resolved identity before calling this (mirrors `createPost`'s `author` param). */
  profileKind: string;
  emoji: PairingReactionEmoji;
}

/**
 * `POST /reactions` (`context_kind: 'pairing'`). Rejects (in order, cheapest check first):
 *  1. a non-`claimed` (ghost/anonymous) caller — pairing reactions are claimed-only, unlike the
 *     `ghost+` generic reactions path;
 *  2. an unknown pairing (`NOT_FOUND`, matching `lib/threads.ts`'s `submitReaction` convention
 *     of a clean 404 over a raw FK violation);
 *  3. a caller who isn't one of the pairing's own two participants — the read side
 *     (`today_reactions`) only has two slots (`a`/`b`) to show a stamp in, so a non-participant
 *     write could never surface anywhere; rejecting it up front avoids a silently-unrenderable
 *     row rather than accepting one;
 *  4. a blocked pair (either direction) — §14.3 block severance, enforced here since no other
 *     layer touches reactions.
 * One stamp per player per ET calendar day (`etDateString`, DD-1): a same-day repost REPLACES
 * the day's stamp (`upsertPairingReaction`'s documented choice over a 409 — see that function's
 * comment in `packages/db/src/repositories/pairings.ts`).
 *
 * Judgment call (fable review of PR #91): no `pairing.status` gate — a participant can stamp a
 * `completed` or `cancelled` (non-block) pairing too, so `/vs/[pairingId]`'s permanent public
 * page stays reactable forever. The spec is silent on this; left open deliberately (trash talk
 * after the week concludes is in-genre, matching how `ReactionStamps`' own copy — "Sweating?",
 * "Called it" — reads equally well post-verdict) rather than gating to `status: 'active'` only.
 * The existing participant-only, block-severed, and rate-limited (§14.1) guards keep the abuse
 * ceiling on a stale pairing the same as on a live one.
 */
export async function submitPairingReaction(
  db: Db,
  input: SubmitPairingReactionInput,
  at: Date,
): Promise<'added' | 'replaced'> {
  if (input.profileKind !== 'claimed') {
    throw new ApiError('FORBIDDEN', 'a claimed profile is required to react to a nemesis matchup');
  }

  const pairing = await getPairingById(db, input.pairingId);
  if (!pairing) {
    throw new ApiError('NOT_FOUND', 'no such pairing');
  }

  if (input.profileId !== pairing.profileAId && input.profileId !== pairing.profileBId) {
    throw new ApiError('FORBIDDEN', "only the pairing's own two players can react to it");
  }

  if (await areProfilesBlocked(db, pairing.profileAId, pairing.profileBId)) {
    throw new ApiError('FORBIDDEN', 'blocked pairs cannot react');
  }

  // Defensive — the route's schema already validates `emoji` against `PAIRING_REACTION_SET`
  // before this function is ever called; this just keeps the function total against a
  // misbehaving future caller rather than trusting the schema silently forever.
  if (!(PAIRING_REACTION_SET as readonly string[]).includes(input.emoji)) {
    throw new ApiError('VALIDATION_FAILED', 'invalid pairing reaction stamp');
  }

  const { state } = await upsertPairingReaction(
    db,
    {
      pairingId: input.pairingId,
      profileId: input.profileId,
      emoji: input.emoji,
      reactionDate: etDateString(at),
    },
    at,
  );
  return state;
}
