/**
 * Account deletion (design doc §11.4, WS2-T5). One transaction: profile soft-deleted with a
 * collision-proof handle/slug rewrite (`deleted-{full uuid}` — NEVER a truncated id, whose
 * uuidv7 timestamp prefix collides within seconds, per the doc's explicit warning), picks
 * hidden (rows retained — aggregates/crowd counts stay truthful), posts marked
 * `removed_by_author`, best-effort wallet/push/notification cleanup, Auth.js user hard-deleted
 * (accounts/sessions cascade via `onDelete: 'cascade'` FKs — email gone), fingerprint/rating
 * rows deleted. Active pairing/duo exit rules and the async analytics/Sentry scrub are
 * SPEC-GAPs — see comments below.
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

    // SPEC-GAP(WS2-T5): active pairing/duo mid-week exit rules (§5.7) deferred — nemesis (WS5)
    // and duo (WS6) don't exist in this wave, so there is nothing to exit yet.

    await tx.delete(fingerprints).where(eq(fingerprints.profileId, profileId));
    await tx.delete(ratings).where(eq(ratings.profileId, profileId));

    // Auth.js hard delete — accounts/sessions cascade via onDelete:'cascade' FKs (email gone).
    await tx.delete(users).where(eq(users.id, userId));

    // SPEC-GAP(WS2-T5): async analytics_events scrub (profile_id/ip_hash/ua_hash nulled) + a
    // Sentry deletion request (§11.4) are deferred — no background job/Sentry integration
    // exists yet in this wave (WS13/§16 scope).

    return { profileId };
  });
}
