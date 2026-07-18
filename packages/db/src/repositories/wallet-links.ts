/**
 * `wallet_links` repository (design doc §5.6, §12, WS12-T1/T2/T3). No credential/key columns
 * exist anywhere on this table (INV-2) — these helpers only ever move an address, its HMAC
 * hash, a resolved proxy address, and the bucketed `enrichment` blob (INV-7).
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { walletLinks } from '../schema/index.js';

export type WalletLinkRow = typeof walletLinks.$inferSelect;
export type NewWalletLinkRow = typeof walletLinks.$inferInsert;

export async function insertWalletLink(db: Db, row: NewWalletLinkRow): Promise<WalletLinkRow> {
  const [inserted] = await db.insert(walletLinks).values(row).returning();
  if (!inserted) throw new Error('insertWalletLink: no row returned');
  return inserted;
}

export async function getWalletLinkById(db: Db, id: string): Promise<WalletLinkRow | null> {
  const [row] = await db.select().from(walletLinks).where(eq(walletLinks.id, id)).limit(1);
  return row ?? null;
}

/** The one `status='active'` link for a profile, if any (§5.6 partial unique constraint). */
export async function getActiveWalletLinkByProfileId(
  db: Db,
  profileId: string,
): Promise<WalletLinkRow | null> {
  const [row] = await db
    .select()
    .from(walletLinks)
    .where(and(eq(walletLinks.profileId, profileId), eq(walletLinks.status, 'active')));
  return row ?? null;
}

/**
 * Most recent link row (any status) for `addressHash` — used for the relink-cooldown check
 * (§12.5: `address_hash` survives unlink solely for this). Not restricted to `status='active'`
 * since the whole point is finding the most recent UNLINK.
 */
export async function getMostRecentWalletLinkByAddressHash(
  db: Db,
  addressHash: string,
): Promise<WalletLinkRow | null> {
  const [row] = await db
    .select()
    .from(walletLinks)
    .where(eq(walletLinks.addressHash, addressHash))
    .orderBy(desc(walletLinks.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * `wallet:ingest` (WS12-T2): persists the bucketed enrichment + resolved proxy, if any.
 * Guarded to `status='active'` — the user can unlink between the job's initial `status==='active'`
 * check and this write (§19.4 rule 4); without the guard, a mid-job unlink would have this write
 * resurrect enrichment data onto a row the unlink just cleared. Returns `null` (not a throw) when
 * that race is hit, so the caller can treat it the same as the pre-job not-active check.
 */
export async function updateWalletLinkEnrichment(
  db: Db,
  id: string,
  patch: { enrichment: WalletLinkRow['enrichment']; proxyAddress?: string | null },
  at: Date,
): Promise<WalletLinkRow | null> {
  const set: Partial<NewWalletLinkRow> = { enrichment: patch.enrichment, updatedAt: at };
  if (patch.proxyAddress !== undefined) set.proxyAddress = patch.proxyAddress;
  const [updated] = await db
    .update(walletLinks)
    .set(set)
    .where(and(eq(walletLinks.id, id), eq(walletLinks.status, 'active')))
    .returning();
  return updated ?? null;
}

/**
 * Unlink (`DELETE /wallet`, §12.5): status → `unlinked`, `enrichment` deleted (set null),
 * `address`/`proxy_address` NULLED — plaintext address does not survive unlink. Only
 * `address_hash` is retained (relink-cooldown check).
 */
export async function unlinkWalletLink(db: Db, id: string, at: Date): Promise<WalletLinkRow> {
  const [updated] = await db
    .update(walletLinks)
    .set({
      status: 'unlinked',
      enrichment: null,
      address: null,
      proxyAddress: null,
      unlinkedAt: at,
      updatedAt: at,
    })
    .where(eq(walletLinks.id, id))
    .returning();
  if (!updated) throw new Error(`unlinkWalletLink: no row for id=${id}`);
  return updated;
}
