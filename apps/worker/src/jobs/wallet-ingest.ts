/**
 * `wallet:ingest` (WS12-T2; §12.3–12.4): enqueued once per successful `POST /wallet/verify`
 * (queue-only, no cron — §12.2 step 4). Resolves the Polymarket proxy contract (best-effort,
 * §12.3 — see `packages/venues/src/polymarket/proxy.ts`'s SPEC-GAP; the documented EOA-only
 * fallback is the SAFE DEFAULT today, not a failure), pulls position/trade history from the
 * Polymarket data API for {address, proxyAddress if resolved}, buckets it IN-MEMORY ONLY via
 * `packages/engine`'s pure `buildWalletEnrichment` (INV-7 — raw notionals are read once to pick
 * a bucket and never persisted), writes `wallet_links.enrichment`, and blends the derived prior
 * into `fingerprints.placement_prior` (§8.7 "average if both wallet and placement priors
 * exist"). Idempotent: a re-run simply re-derives and overwrites from a fresh data-api pull.
 */
import { z } from 'zod';
import type { Address } from 'viem';
import { now, walletEnrichmentSchema, type FingerprintPrior } from '@receipts/core';
import {
  getFingerprintRow,
  getWalletLinkById,
  updateWalletLinkEnrichment,
  upsertFingerprintPrior,
  type Db,
} from '@receipts/db';
import {
  PolymarketDataApiClient,
  mapPolymarketCategory,
  resolvePolymarketProxy,
  type PolymarketActivity,
  type PolymarketPosition,
} from '@receipts/venues';
import { blendWalletPriorIntoExisting, buildWalletEnrichment, type WalletPositionInput } from '@receipts/engine';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export const walletIngestJobDataSchema = z.object({ walletLinkId: z.string().min(1) });
export type WalletIngestJobData = z.infer<typeof walletIngestJobDataSchema>;

function toNumber(v: string | number | undefined | null): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** `YYYY-MM` in UTC — matches `packages/engine`'s `first_seen` formatting (§12.4). */
function toYearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function positionNotionalUsd(p: PolymarketPosition): number {
  const initialValue = toNumber(p.initialValue);
  if (initialValue !== undefined) return Math.max(0, initialValue);
  const size = toNumber(p.size) ?? 0;
  const avgPrice = toNumber(p.avgPrice) ?? 0;
  return Math.max(0, size * avgPrice);
}

function toPositionInput(p: PolymarketPosition): WalletPositionInput {
  return {
    notionalUsd: positionNotionalUsd(p),
    // Best-effort (SPEC-GAP, fixtures/venue-notes.md): `avgPrice` is assumed to already be the
    // implied probability of the HELD side, matching our own `p_i` definition (§8.1).
    entryProbability: toNumber(p.avgPrice) ?? 0.5,
    category: mapPolymarketCategory(p.category ?? p.title ?? null),
    // The positions endpoint doesn't carry a per-position timestamp (SPEC-GAP) — first_seen is
    // derived separately from the activity endpoint below, when available.
    enteredAt: null,
  };
}

/**
 * A genuinely-empty wallet (never traded) already resolves to `[]` inside `getPositions`
 * itself (404 -> `[]`, §7.4/data-api.ts). A real upstream failure (network, 5xx, malformed
 * body) must propagate so the job fails and pg-boss retries (§2.4/§7.5) — swallowing it here
 * would silently persist zeroed enrichment as if it were a real "no positions" result, and a
 * later successful re-run would overwrite any previously-ingested real data with zeros in the
 * interim. No try/catch: let the caller's Promise.all reject.
 */
function fetchPositions(client: PolymarketDataApiClient, address: string): Promise<PolymarketPosition[]> {
  return client.getPositions(address);
}

function earliestActivityMonth(activity: readonly PolymarketActivity[]): string | null {
  const timestamps = activity
    .map((a) => toNumber(a.timestamp))
    .filter((t): t is number => t !== undefined);
  if (timestamps.length === 0) return null;
  return toYearMonth(new Date(Math.min(...timestamps) * 1000));
}

export interface WalletIngestDeps {
  dataApiClient?: PolymarketDataApiClient;
  at?: Date;
}

export type WalletIngestResult =
  | { status: 'not-found' }
  | { status: 'not-active' }
  | { status: 'ingested'; positionsFound: number; proxyResolved: boolean };

/**
 * Runs one wallet-ingest cycle for `walletLinkId`. Exported (not just the pg-boss handler) so
 * it's directly testable against a real Postgres with an injected fake `PolymarketDataApiClient`
 * — no live network required for the integration test's fallback-path coverage.
 */
export async function runWalletIngest(
  db: Db,
  walletLinkId: string,
  deps: WalletIngestDeps = {},
): Promise<WalletIngestResult> {
  const at = deps.at ?? now();
  const link = await getWalletLinkById(db, walletLinkId);
  if (!link) return { status: 'not-found' };
  // Idempotency guard (§19.4 rule 4): the user may have unlinked between enqueue and run.
  if (link.status !== 'active' || !link.address) return { status: 'not-active' };

  const client = deps.dataApiClient ?? new PolymarketDataApiClient();
  const eoa = link.address as Address;
  const proxy = resolvePolymarketProxy(eoa);
  if (!proxy.verified) {
    logger.info({ walletLinkId, reason: proxy.reason }, 'wallet:ingest proxy fallback (EOA-only)');
  }

  const addresses = [link.address, ...(proxy.proxyAddress ? [proxy.proxyAddress] : [])];

  const positionLists = await Promise.all(addresses.map((a) => fetchPositions(client, a)));
  const positions = positionLists.flat();

  const activityLists = await Promise.all(
    addresses.map((a) => client.getActivity(a)), // never throws (§12.4 best-effort)
  );
  const activity = activityLists.flat();

  const { enrichment: builtEnrichment, prior } = buildWalletEnrichment(positions.map(toPositionInput));
  const activityFirstSeen = earliestActivityMonth(activity);
  // Prefer whichever source found an earlier month — positions carry no timestamp today
  // (SPEC-GAP), so this is effectively "use activity's first_seen when we have one."
  const firstSeen =
    activityFirstSeen && (!builtEnrichment.firstSeen || activityFirstSeen < builtEnrichment.firstSeen)
      ? activityFirstSeen
      : builtEnrichment.firstSeen;
  const enrichment = { ...builtEnrichment, firstSeen };
  walletEnrichmentSchema.parse(enrichment); // fail loudly before ever persisting a malformed shape

  await updateWalletLinkEnrichment(
    db,
    walletLinkId,
    { enrichment, proxyAddress: proxy.proxyAddress },
    at,
  );

  const existing = await getFingerprintRow(db, link.profileId);
  const blended: FingerprintPrior = blendWalletPriorIntoExisting(
    existing?.placementPrior as FingerprintPrior | null | undefined,
    prior,
  );
  await upsertFingerprintPrior(db, link.profileId, blended, at);

  return { status: 'ingested', positionsFound: positions.length, proxyResolved: proxy.verified };
}

export const walletIngestHandler: JobHandler = async (ctx, data) => {
  const { walletLinkId } = walletIngestJobDataSchema.parse(data);
  const result = await runWalletIngest(ctx.db, walletLinkId);
  logger.info({ walletLinkId, result }, 'wallet:ingest complete');
};
