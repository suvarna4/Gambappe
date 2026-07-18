/**
 * Which Auth.js providers are actually enabled (design doc §11.1: "V1 may ship email+Google
 * only if X app approval lags"). Mirrors the same env-presence gate `auth.ts` uses for the
 * Twitter/X provider, so the claim UI never offers a sign-in option the server can't complete.
 * Kept separate from `auth.ts` so this can be imported by a plain server component without
 * pulling in `next-auth` (same rationale as `identity.ts` vs `identity-request.ts`).
 */
export type AuthProviderId = 'google' | 'email' | 'x';

type EnvLike = Record<string, string | undefined>;

export function getEnabledAuthProviders(env: EnvLike = process.env): AuthProviderId[] {
  const providers: AuthProviderId[] = ['google', 'email'];
  if (env.AUTH_TWITTER_ID && env.AUTH_TWITTER_SECRET) providers.push('x');
  return providers;
}
