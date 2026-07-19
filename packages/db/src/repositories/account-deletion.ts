/**
 * Account deletion (design doc §11.4, WS2-T5). One transaction: profile soft-deleted with a
 * collision-proof handle/slug rewrite (`deleted-{full uuid}` — NEVER a truncated id, whose
 * uuidv7 timestamp prefix collides within seconds, per the doc's explicit warning), picks
 * hidden (rows retained — aggregates/crowd counts stay truthful), posts marked
 * `removed_by_author`, best-effort wallet/push/notification cleanup, Auth.js user hard-deleted
 * (accounts/sessions cascade via `onDelete: 'cascade'` FKs — email gone), fingerprint/rating
 * rows deleted, and the profile's `analytics_events` trail scrubbed (`profile_id`/`ip_hash`/
 * `ua_hash` nulled — §11.4's RT-B guarantee that no 13-month behavioral trail survives
 * erasure). The Sentry half of §11.4's post-deletion scrub is still a SPEC-GAP — see below.
 *
 * Active NEMESIS pairing / DUO match mid-week exit (§5.7) is deliberately NOT done in this
 * function — `packages/db` has no `@receipts/engine` dependency (§4.2), and the exit rule
 * needs `scoreNemesisWeek`/`scoreDuoMatch`/`updateGlicko2` from it. The caller-side wrapper
 * `deleteClaimedAccount` (`apps/web/lib/account-deletion.ts`) runs both exits and then this
 * function in one transaction; `DELETE /api/v1/me` goes through that wrapper, never through
 * this function directly.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  analyticsEvents,
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

    // Nemesis pairing + duo match mid-week exits (§5.7) are handled by the CALLER, before this
    // function runs (same transaction, via `deleteClaimedAccount` — see this file's header).
    // Ordering matters: the exits queue §14.3's neutral "ended early" notification for BOTH
    // sides of any concluded pairing/match, and the queued-notification cancellation above then
    // suppresses the deleted profile's copy while the surviving opponent keeps theirs.

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

    // §11.4 analytics scrub (an explicit RT-B red-team remediation): null the erased profile's
    // behavioral trail — rows are RETAINED for aggregate metrics, only the identifying columns
    // go. §11.4 permits doing this asynchronously; running it inside the deletion transaction
    // is strictly stronger and cheap (`analytics_events_profile_ts_idx` serves the WHERE).
    await tx
      .update(analyticsEvents)
      .set({ profileId: null, ipHash: null, uaHash: null })
      .where(eq(analyticsEvents.profileId, profileId));

    // SPEC-GAP(WS2-T5): the Sentry deletion request half of §11.4's scrub (events tagged with
    // the profile id) stays deferred — no Sentry integration exists yet (§16.2 scope).

    return { profileId };
  });
}
