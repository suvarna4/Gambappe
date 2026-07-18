/**
 * `POST /api/v1/wallet/verify` (design doc §12.2 steps 3–4, WS12-T1). Auth: claimed. Thin
 * adapter over `wallet-flow.ts`'s `verifyWalletLink` — see that file for the actual domain/
 * nonce/expiry/address/signature checks and the `wallet_links` insert. This file wires in the
 * real Polygon-RPC signature verifier, the real Redis nonce store, and the fire-and-forget
 * `wallet:ingest` enqueue (§12.2 step 4: "don't block on ingestion").
 */
import type { NextResponse } from 'next/server';
import { ApiError, RL_SIWE_PROFILE_H, isFlagEnabled, now, walletVerifyBodySchema } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { verifyWalletLink } from '@/lib/wallet-flow';
import { verifySiweSignature } from '@/lib/wallet-verify';
import { RedisWalletNonceStore } from '@/lib/wallet-nonce-store';
import { RedisWalletSiweLimiter, walletSiweHourKey } from '@/lib/wallet-siwe-limiter';
import { enqueueWalletIngest } from '@/lib/wallet-queue';
import { getDb, getRedis } from '@/lib/stores';

export const runtime = 'nodejs';

function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) throw new Error('NEXT_PUBLIC_APP_URL is not set (see .env.example)');
  return url;
}

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);
    if (!isFlagEnabled('wallet_linking')) throw new ApiError('NOT_FOUND', 'not found');

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind !== 'claimed') throw new ApiError('UNAUTHENTICATED', 'a claimed profile is required');

    // §14.1 "SIWE nonce/verify | profile | 10/hour" — one shared budget across nonce + verify.
    const limiter = new RedisWalletSiweLimiter(getRedis());
    const count = await limiter.increment(identity.profile.id, walletSiweHourKey(now()));
    if (count > RL_SIWE_PROFILE_H) throw new ApiError('RATE_LIMITED', 'too many wallet-link attempts, try again later');

    const body = walletVerifyBodySchema.parse(await request.json());
    const result = await verifyWalletLink(
      { profileId: identity.profile.id, body, appUrl: appUrl() },
      {
        db: getDb(),
        nonceStore: new RedisWalletNonceStore(getRedis()),
        verifySignature: verifySiweSignature,
        at: now(),
      },
    );

    // Fire-and-forget (§12.2 step 4): an ingestion enqueue failure must never fail this
    // response — the wallet is already verified and linked regardless of import success.
    enqueueWalletIngest({ walletLinkId: result.walletLinkId }).catch((err: unknown) => {
      console.warn('wallet:ingest enqueue failed', { walletLinkId: result.walletLinkId, err });
    });

    return jsonSuccess({ status: result.status, ingestion: result.ingestion });
  });
}
