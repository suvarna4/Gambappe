/**
 * Which Auth.js providers are actually enabled (design doc §11.1: "V1 may ship email+Google
 * only if X app approval lags"). Mirrors the same env-presence gate `auth.ts` uses for the
 * Twitter/X provider, so the claim UI never offers a sign-in option the server can't complete.
 * Kept separate from `auth.ts` so this can be imported by a plain server component without
 * pulling in `next-auth` (same rationale as `identity.ts` vs `identity-request.ts`).
 *
 * WS25-T1 (design-diff audit): `'google'` used to be hardcoded into the returned array
 * unconditionally, contradicting this doc comment's own claim of mirroring the X/Twitter gate —
 * the button rendered and was clickable even with no `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`
 * configured, building a `client_id=undefined` OAuth request that Google rejects and Auth.js
 * surfaces as its generic `/api/auth/error?error=Configuration` page. Now gated identically to
 * `'x'`. `'email'` stays unconditional — it has no OAuth client id/secret to be missing; its own
 * production-readiness is `auth.ts`'s `sendVerificationRequest` concern (WS25-T3), not a
 * provider-registration one.
 */
export type AuthProviderId = 'google' | 'email' | 'x';

type EnvLike = Record<string, string | undefined>;

export function getEnabledAuthProviders(env: EnvLike = process.env): AuthProviderId[] {
  const providers: AuthProviderId[] = ['email'];
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) providers.push('google');
  if (env.AUTH_TWITTER_ID && env.AUTH_TWITTER_SECRET) providers.push('x');
  return providers;
}
