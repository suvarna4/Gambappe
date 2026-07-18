/**
 * WS12-T2 integration: `wallet:ingest` against a real Postgres. Covers the AC that matters
 * most for this job — the "graceful fallback path" (§12.3): with the Polymarket proxy factory
 * constants unverified (SPEC-GAP, `packages/venues/src/polymarket/proxy.ts`), proxy resolution
 * ALWAYS falls back today, so this test doubles as that AC — ingestion still succeeds from the
 * EOA address alone. Also covers idempotency (re-run overwrites, never accumulates) and the
 * not-active no-op guard (§19.4 rule 4). Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { uuidv7 } from 'uuidv7';
import type pg from 'pg';
import { connect, fingerprints, profiles, walletLinks, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { PolymarketDataApiClient, createVenueHttpClient } from '@receipts/venues';
import { runWalletIngest } from '../../src/jobs/wallet-ingest.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const NOW = new Date('2026-07-19T10:10:00Z');
const DATA_BASE = 'https://data-api.test';
const EOA = '0x1111111111111111111111111111111111111a';

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  ({ pool, db } = connect({ connectionString: url }));
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await migrate(db, {
    migrationsFolder: join(
      dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', '..', 'packages', 'db', 'drizzle',
    ),
  });
});

afterAll(async () => {
  await pool.end();
});

function router(url: URL): { status: number; body: unknown } | undefined {
  if (url.hostname !== 'data-api.test') return undefined;
  if (url.pathname === '/positions') {
    return {
      status: 200,
      body: [
        { conditionId: 'c1', title: 'Election', category: 'Politics', outcome: 'Yes', size: 100, avgPrice: 0.6, initialValue: 60 },
        { conditionId: 'c2', title: 'Big game', category: 'Sports', outcome: 'No', size: 20, avgPrice: 0.3, initialValue: 6 },
      ],
    };
  }
  if (url.pathname === '/activity') {
    return { status: 200, body: [{ type: 'TRADE', timestamp: 1_700_000_000, usdcSize: 60, price: 0.6 }] };
  }
  return undefined;
}

function fakeDataApiClient(): PolymarketDataApiClient {
  return new PolymarketDataApiClient({
    dataBaseUrl: DATA_BASE,
    http: createVenueHttpClient({
      fetchImpl: (async (input: string | URL) => {
        const u = new URL(typeof input === 'string' ? input : input.toString());
        const route = router(u);
        if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
      rps: 1000,
      timeoutMs: 2_000,
      maxRetries: 0,
    }),
  });
}

async function insertActiveLink(): Promise<{ profileId: string; walletLinkId: string }> {
  const profile = buildProfile({ kind: 'claimed' });
  await db.insert(profiles).values(profile);
  const walletLinkId = uuidv7();
  await db.insert(walletLinks).values({
    id: walletLinkId,
    profileId: profile.id as string,
    address: EOA,
    addressHash: `test-address-hash-${walletLinkId}`,
    verifiedAt: NOW,
    status: 'active',
  });
  return { profileId: profile.id as string, walletLinkId };
}

describe('wallet:ingest (§12.3–12.4)', () => {
  it('graceful fallback: proxy resolution falls back (unverified constants), EOA-only ingestion still succeeds', async () => {
    const { profileId, walletLinkId } = await insertActiveLink();

    const result = await runWalletIngest(db, walletLinkId, { dataApiClient: fakeDataApiClient(), at: NOW });
    expect(result).toEqual({ status: 'ingested', positionsFound: 2, proxyResolved: false });

    const [linkAfter] = await db.select().from(walletLinks).where(eq(walletLinks.id, walletLinkId));
    expect(linkAfter!.proxyAddress).toBeNull(); // fallback: no proxy ever resolved
    expect(linkAfter!.enrichment).toMatchObject({ trades: 2 });
    // INV-7: only counts/priors, never a raw dollar amount (deep coverage is the engine unit
    // test; this integration test just asserts the persisted row shape is the expected one).
    expect(linkAfter!.enrichment).not.toHaveProperty('rawPositions');
    expect((linkAfter!.enrichment as { buckets: Record<string, number> }).buckets).toBeDefined();

    const [fpAfter] = await db.select().from(fingerprints).where(eq(fingerprints.profileId, profileId));
    expect(fpAfter).toBeDefined();
    expect(fpAfter!.placementPrior).toMatchObject({ chalk: expect.any(Number) });
  });

  it('idempotent: re-running overwrites rather than accumulating', async () => {
    const { walletLinkId } = await insertActiveLink();
    const client = fakeDataApiClient();

    await runWalletIngest(db, walletLinkId, { dataApiClient: client, at: NOW });
    await runWalletIngest(db, walletLinkId, { dataApiClient: client, at: NOW });

    const [linkAfter] = await db.select().from(walletLinks).where(eq(walletLinks.id, walletLinkId));
    expect((linkAfter!.enrichment as { trades: number }).trades).toBe(2); // not 4
  });

  it('not-active guard: an unlinked wallet link is a no-op, not an error', async () => {
    const { walletLinkId } = await insertActiveLink();
    await db.update(walletLinks).set({ status: 'unlinked', address: null }).where(eq(walletLinks.id, walletLinkId));

    const result = await runWalletIngest(db, walletLinkId, { dataApiClient: fakeDataApiClient(), at: NOW });
    expect(result).toEqual({ status: 'not-active' });
  });

  it('unknown wallet link id: not-found, not an error', async () => {
    const result = await runWalletIngest(db, uuidv7(), { dataApiClient: fakeDataApiClient(), at: NOW });
    expect(result).toEqual({ status: 'not-found' });
  });

  it('mid-job unlink race: a link unlinked after the initial status check is not resurrected', async () => {
    const { profileId, walletLinkId } = await insertActiveLink();

    // Simulate the user unlinking between runWalletIngest's initial status==='active' check and
    // the later updateWalletLinkEnrichment write, by unlinking from inside the fake data-api call.
    const client = new PolymarketDataApiClient({
      dataBaseUrl: DATA_BASE,
      http: createVenueHttpClient({
        fetchImpl: (async (input: string | URL) => {
          await db.update(walletLinks).set({ status: 'unlinked', address: null }).where(eq(walletLinks.id, walletLinkId));
          const u = new URL(typeof input === 'string' ? input : input.toString());
          const route = router(u);
          if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
          return new Response(JSON.stringify(route.body), {
            status: route.status,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
        rps: 1000,
        timeoutMs: 2_000,
        maxRetries: 0,
      }),
    });

    const result = await runWalletIngest(db, walletLinkId, { dataApiClient: client, at: NOW });
    expect(result).toEqual({ status: 'not-active' });

    const [linkAfter] = await db.select().from(walletLinks).where(eq(walletLinks.id, walletLinkId));
    expect(linkAfter!.enrichment).toBeNull(); // not resurrected by the in-flight job

    const [fpAfter] = await db.select().from(fingerprints).where(eq(fingerprints.profileId, profileId));
    expect(fpAfter).toBeUndefined(); // no stale wallet prior blended in either
  });
});
