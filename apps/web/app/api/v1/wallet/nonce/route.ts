/**
 * `POST /api/v1/wallet/nonce` (design doc §12.2 step 1, WS12-T1). Auth: claimed. Thin adapter
 * over `wallet-flow.ts`'s `buildWalletNonceMessage` — see that file for the actual logic.
 */
import type { NextResponse } from 'next/server';
import { ApiError, RL_SIWE_PROFILE_H, isFlagEnabled, now, walletNonceBodySchema } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { buildWalletNonceMessage } from '@/lib/wallet-flow';
import { RedisWalletNonceStore } from '@/lib/wallet-nonce-store';
import { RedisWalletSiweLimiter, walletSiweHourKey } from '@/lib/wallet-siwe-limiter';
import { getRedis } from '@/lib/stores';

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

    const body = walletNonceBodySchema.parse(await request.json());
    const result = await buildWalletNonceMessage(
      { profileId: identity.profile.id, address: body.address, appUrl: appUrl() },
      { nonceStore: new RedisWalletNonceStore(getRedis()), at: now() },
    );

    return jsonSuccess(result);
  });
}
