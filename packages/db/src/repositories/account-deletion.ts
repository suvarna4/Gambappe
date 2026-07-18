/**
 * Account deletion (design doc §11.4, WS2-T5). One transaction: profile soft-deleted with a
 * collision-proof handle/slug rewrite (`deleted-{full uuid}` — NEVER a truncated id, whose
 * uuidv7 timestamp prefix collides within seconds, per the doc's explicit warning), picks
 * hidden (rows retained — aggregates/crowd counts stay truthful), posts marked
 * `removed_by_author`, best-effort wallet/push/notification cleanup, Auth.js user hard-deleted
 * (accounts/sessions cascade via `onDelete: 'cascade'` FKs — email gone), fingerprint/rating
 * rows deleted. The async analytics/Sentry scrub is a SPEC-GAP — see comment below.
 *
 * Active DUO match exit (§5.7, WS6-T2) is deliberately NOT done in this function — `packages/db`
 * has no `@receipts/engine` dependency (§4.2), and the mid-window-exit rule needs
 * `scoreDuoMatch`/`updateGlicko2` from it. `DELETE /api/v1/me` (apps/web) calls
 * `applyDuoMidWindowExit` (`apps/web/lib/duo-match-lifecycle.ts`) before calling this function
 * instead. (Active NEMESIS pairing exit on deletion remains an open SPEC-GAP — WS5 doesn't
 * exist in this wave either; unlike duo, no caller-side follow-up has been wired for it yet.)
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  fingerprints,
  notifications,
  picks,
  posts,
  profiles,
  pushSubscriptions,
  ratings,
  users,
  verificationTokens,
  walletLinks,
} from '../schema/index.js';

export interface DeleteAccountResult {
  profileId: string;
}

export async function deleteAccount(
  db: Db,
  profileId: string,
  userId: string,
  at: Date,
): Promise<DeleteAccountResult> {
  return db.transaction(async (tx) => {
    const deletedHandle = `deleted-${profileId}`;
    await tx
      .update(profiles)
      .set({ status: 'deleted', handle: deletedHandle, slug: deletedHandle, updatedAt: at })
      .where(eq(profiles.id, profileId));

    await tx.update(picks).set({ isPublic: false }).where(eq(picks.profileId, profileId));

    await tx
      .update(posts)
      .set({ status: 'removed_by_author', updatedAt: at })
      .where(eq(posts.profileId, profileId));

    // Best-effort unlink (mirrors §12.5's unlink shape) — the full wallet-unlink business logic
    // is WS12 scope; wallet_linking isn't built/enabled in this wave anyway.
    await tx
      .update(walletLinks)
      .set({
        status: 'unlinked',
        enrichment: null,
        address: null,
        proxyAddress: null,
        unlinkedAt: at,
        updatedAt: at,
      })
      .where(and(eq(walletLinks.profileId, profileId), eq(walletLinks.status, 'active')));

    await tx.update(pushSubscriptions).set({ revokedAt: at }).where(eq(pushSubscriptions.profileId, profileId));

    await tx
      .update(notifications)
      .set({ status: 'cancelled' })
      .where(and(eq(notifications.profileId, profileId), eq(notifications.status, 'queued')));

    // Duo match mid-window exit (§5.7) is handled by the CALLER, before this function runs —
    // see this file's header. SPEC-GAP(WS2-T5, still open): active nemesis pairing exit on
    // deletion — WS5 doesn't exist in this wave, so there is nothing to exit yet, and (unlike
    // duo) no caller-side follow-up exists for it either.

    await tx.delete(fingerprints).where(eq(fingerprints.profileId, profileId));
    await tx.delete(ratings).where(eq(ratings.profileId, profileId));

    // verification_tokens has no FK to users (Auth.js keys it by email, `identifier`) — the
    // users hard-delete below cascades accounts/sessions but can't touch this table, so a
    // pending magic-link row would otherwise survive deletion and falsify §11.4/§11.5 "email
    // gone" (a stale token still round-trips through the identifier value).
    const [deletingUser] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (deletingUser?.email) {
      await tx.delete(verificationTokens).where(eq(verificationTokens.identifier, deletingUser.email));
    }

    // Auth.js hard delete — accounts/sessions cascade via onDelete:'cascade' FKs (email gone).
    await tx.delete(users).where(eq(users.id, userId));

    // SPEC-GAP(WS2-T5): async analytics_events scrub (profile_id/ip_hash/ua_hash nulled) + a
    // Sentry deletion request (§11.4) are deferred — no background job/Sentry integration
    // exists yet in this wave (WS13/§16 scope).

    return { profileId };
  });
}
