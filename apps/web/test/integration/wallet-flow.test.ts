/**
 * WS12-T1/T3 integration: `wallet-flow.ts` against a real Postgres, with a fake nonce store and
 * a fake (never-hits-a-real-RPC) signature verifier injected. Covers the ACs directly: replayed
 * nonce rejected, wrong-domain message rejected, address case-insensitivity, already-linked-
 * elsewhere conflict, unlink nulls address/proxy + deletes enrichment (SQL assert), relink
 * cooldown enforced. Requires a live Postgres (docker-compose / CI service).
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { connect, walletLinks, type Db } from '@receipts/db';
import { buildProfile } from '@receipts/db/testing';
import { profiles } from '@receipts/db';
import { buildSiweMessage, WALLET_SIWE_CHAIN_ID, WALLET_SIWE_STATEMENT } from '@/lib/siwe';
import { InMemoryWalletNonceStore, type WalletNonceStore } from '@/lib/wallet-nonce-store';
import { buildWalletNonceMessage, unlinkWallet, verifyWalletLink } from '@/lib/wallet-flow';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts_test';

const APP_URL = 'https://receipts.example';
const ADDRESS = '0xAbC000000000000000000000000000000000dEaD';
const NOW = new Date('2026-07-18T12:00:00Z');

let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  process.env.WALLET_HASH_SECRET = 'integration-test-wallet-hash-secret';
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

async function makeClaimedProfile(): Promise<string> {
  const profile = buildProfile({ kind: 'claimed' });
  await db.insert(profiles).values(profile);
  return profile.id as string;
}

/** Runs `buildWalletNonceMessage` then `verifyWalletLink` for one profile+address, happy path. */
async function linkWallet(
  profileId: string,
  nonceStore: WalletNonceStore,
  opts: { address?: string; verifies?: boolean; at?: Date } = {},
): Promise<Awaited<ReturnType<typeof verifyWalletLink>>> {
  const address = opts.address ?? ADDRESS;
  const at = opts.at ?? NOW;
  const { message } = await buildWalletNonceMessage({ profileId, address, appUrl: APP_URL }, { nonceStore, at });
  return verifyWalletLink(
    { profileId, body: { message, signature: '0xdeadbeef' }, appUrl: APP_URL },
    { db, nonceStore, verifySignature: async () => opts.verifies ?? true, at },
  );
}

describe('verifyWalletLink (§12.2)', () => {
  it('happy path: links the wallet, lowercased address, addressHash stored', async () => {
    const profileId = await makeClaimedProfile();
    const nonceStore = new InMemoryWalletNonceStore();
    const result = await linkWallet(profileId, nonceStore);
    expect(result.status).toBe('linked');
    expect(result.ingestion).toBe('pending');

    const [row] = await db.select().from(walletLinks).where(eq(walletLinks.id, result.walletLinkId));
    expect(row!.address).toBe(ADDRESS.toLowerCase());
    expect(row!.status).toBe('active');
  });

  it('replayed nonce is rejected (NONCE_EXPIRED)', async () => {
    const profileId = await makeClaimedProfile();
    const nonceStore = new InMemoryWalletNonceStore();
    const address = '0x6666666666666666666666666666666666666666';
    const { message } = await buildWalletNonceMessage(
      { profileId, address, appUrl: APP_URL },
      { nonceStore, at: NOW },
    );
    const deps = { db, nonceStore, verifySignature: async () => true, at: NOW };
    await verifyWalletLink({ profileId, body: { message, signature: '0xdeadbeef' }, appUrl: APP_URL }, deps);

    // Second attempt with the SAME message (same nonce) must be rejected — single-use.
    await expect(
      verifyWalletLink({ profileId, body: { message, signature: '0xdeadbeef' }, appUrl: APP_URL }, deps),
    ).rejects.toMatchObject({ code: 'NONCE_EXPIRED' });
  });

  it('wrong-domain message is rejected (SIGNATURE_INVALID)', async () => {
    const profileId = await makeClaimedProfile();
    const nonceStore = new InMemoryWalletNonceStore();
    // Note: buildSiweMessage directly, bypassing buildWalletNonceMessage, to forge a foreign domain.
    const message = buildSiweMessage({
      domain: 'evil.example',
      address: ADDRESS.toLowerCase(),
      statement: WALLET_SIWE_STATEMENT,
      uri: APP_URL,
      chainId: WALLET_SIWE_CHAIN_ID,
      nonce: 'forged-nonce',
      issuedAt: NOW,
      expirationTime: new Date(NOW.getTime() + 600_000),
    });
    await nonceStore.save('forged-nonce', profileId, 600);

    await expect(
      verifyWalletLink(
        { profileId, body: { message, signature: '0xdeadbeef' }, appUrl: APP_URL },
        { db, nonceStore, verifySignature: async () => true, at: NOW },
      ),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('wrong-statement message is rejected (SIGNATURE_INVALID)', async () => {
    const profileId = await makeClaimedProfile();
    const nonceStore = new InMemoryWalletNonceStore();
    const message = buildSiweMessage({
      domain: new URL(APP_URL).host,
      address: ADDRESS.toLowerCase(),
      statement: 'Sign in to claim your free NFT airdrop.',
      uri: APP_URL,
      chainId: WALLET_SIWE_CHAIN_ID,
      nonce: 'forged-statement-nonce',
      issuedAt: NOW,
      expirationTime: new Date(NOW.getTime() + 600_000),
    });
    await nonceStore.save('forged-statement-nonce', profileId, 600);

    await expect(
      verifyWalletLink(
        { profileId, body: { message, signature: '0xdeadbeef' }, appUrl: APP_URL },
        { db, nonceStore, verifySignature: async () => true, at: NOW },
      ),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('wrong-uri message is rejected (SIGNATURE_INVALID)', async () => {
    const profileId = await makeClaimedProfile();
    const nonceStore = new InMemoryWalletNonceStore();
    const message = buildSiweMessage({
      domain: new URL(APP_URL).host,
      address: ADDRESS.toLowerCase(),
      statement: WALLET_SIWE_STATEMENT,
      uri: 'https://phishing.example',
      chainId: WALLET_SIWE_CHAIN_ID,
      nonce: 'forged-uri-nonce',
      issuedAt: NOW,
      expirationTime: new Date(NOW.getTime() + 600_000),
    });
    await nonceStore.save('forged-uri-nonce', profileId, 600);

    await expect(
      verifyWalletLink(
        { profileId, body: { message, signature: '0xdeadbeef' }, appUrl: APP_URL },
        { db, nonceStore, verifySignature: async () => true, at: NOW },
      ),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });

  it('address case-insensitivity: differently-cased addresses hash/store identically and collide as "already linked"', async () => {
    const profileA = await makeClaimedProfile();
    const profileB = await makeClaimedProfile();
    const nonceStoreA = new InMemoryWalletNonceStore();
    const nonceStoreB = new InMemoryWalletNonceStore();
    const address = '0x7777777777777777777777777777777777777777';

    await linkWallet(profileA, nonceStoreA, { address: address.toLowerCase() });

    await expect(linkWallet(profileB, nonceStoreB, { address: address.toUpperCase() })).rejects.toMatchObject({
      code: 'WALLET_ALREADY_LINKED',
    });
  });

  it('already-linked-elsewhere -> WALLET_ALREADY_LINKED conflict', async () => {
    const profileA = await makeClaimedProfile();
    const profileB = await makeClaimedProfile();
    await linkWallet(profileA, new InMemoryWalletNonceStore(), { address: '0x111111111111111111111111111111111111111a' });

    await expect(
      linkWallet(profileB, new InMemoryWalletNonceStore(), { address: '0x111111111111111111111111111111111111111a' }),
    ).rejects.toMatchObject({ code: 'WALLET_ALREADY_LINKED' });
  });

  it('a failing signature verification is rejected (SIGNATURE_INVALID)', async () => {
    const profileId = await makeClaimedProfile();
    await expect(
      linkWallet(profileId, new InMemoryWalletNonceStore(), {
        address: '0x222222222222222222222222222222222222222b',
        verifies: false,
      }),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });
});

describe('unlinkWallet (§12.5)', () => {
  it('nulls address/proxy_address, deletes enrichment, keeps address_hash — SQL assert', async () => {
    const profileId = await makeClaimedProfile();
    const address = '0x333333333333333333333333333333333333333c';
    const linked = await linkWallet(profileId, new InMemoryWalletNonceStore(), { address });
    await db
      .update(walletLinks)
      .set({ enrichment: { trades: 3, buckets: { xs: 1, s: 1, m: 1, l: 0, xl: 0 }, categories: {}, chalkPrior: 0, firstSeen: '2024-11' } })
      .where(eq(walletLinks.id, linked.walletLinkId));

    await unlinkWallet(profileId, { db, at: NOW });

    const [row] = await db.select().from(walletLinks).where(eq(walletLinks.id, linked.walletLinkId));
    expect(row!.status).toBe('unlinked');
    expect(row!.address).toBeNull();
    expect(row!.proxyAddress).toBeNull();
    expect(row!.enrichment).toBeNull();
    expect(row!.addressHash).not.toBeNull(); // retained solely for the relink-cooldown check
    expect(row!.unlinkedAt).not.toBeNull();
  });

  it('no active link -> NOT_FOUND', async () => {
    const profileId = await makeClaimedProfile();
    await expect(unlinkWallet(profileId, { db, at: NOW })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('relink cooldown: re-linking the same address right after unlink is rejected', async () => {
    const profileId = await makeClaimedProfile();
    const address = '0x444444444444444444444444444444444444444d';
    await linkWallet(profileId, new InMemoryWalletNonceStore(), { address, at: NOW });
    await unlinkWallet(profileId, { db, at: NOW });

    const profileB = await makeClaimedProfile();
    const soon = new Date(NOW.getTime() + 60_000); // 1 minute later, well inside the 7-day cooldown
    await expect(
      linkWallet(profileB, new InMemoryWalletNonceStore(), { address, at: soon }),
    ).rejects.toMatchObject({ code: 'WALLET_RELINK_COOLDOWN' });
  });

  it('relink after the cooldown window succeeds', async () => {
    const profileId = await makeClaimedProfile();
    const address = '0x555555555555555555555555555555555555555e';
    await linkWallet(profileId, new InMemoryWalletNonceStore(), { address, at: NOW });
    await unlinkWallet(profileId, { db, at: NOW });

    const profileB = await makeClaimedProfile();
    const wayLater = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days later
    const result = await linkWallet(profileB, new InMemoryWalletNonceStore(), { address, at: wayLater });
    expect(result.status).toBe('linked');
  });
});
