'use server';

/**
 * Sign-in server actions for the claim flow (design doc §6.3: "Auth.js sign-in (email link /
 * Google / X)"). Thin wrappers around Auth.js v5's server `signIn()` so the client-side
 * `ClaimEntry` component can invoke them as `<form action={...}>` targets (the officially
 * documented App Router pattern — see `next-auth`'s own `index.d.ts` doc comment on `signIn`).
 *
 * Every provider redirects back to `/claim` (§6.3: "post-auth landing"), which is the single
 * canonical place `POST /api/v1/claim` gets called from, regardless of which page the claim
 * prompt was triggered on (a claim overlay opened from an arbitrary page can't reliably still be
 * mounted after an OAuth round trip away from and back to the browser).
 */
import { signIn } from '../../auth';

const CLAIM_CALLBACK_URL = '/claim';

export async function signInWithGoogle(): Promise<void> {
  await signIn('google', { redirectTo: CLAIM_CALLBACK_URL });
}

export async function signInWithTwitter(): Promise<void> {
  await signIn('twitter', { redirectTo: CLAIM_CALLBACK_URL });
}

export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  await signIn('email', { email, redirectTo: CLAIM_CALLBACK_URL });
}
