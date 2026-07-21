/**
 * `/claim` — design doc §10.1: "SSR — Auth + claim flow + placement offer." The canonical
 * post-auth landing (§6.3): every sign-in action in `ClaimEntry` redirects here. A session
 * already present means we're on the way back from Auth.js — render `ClaimCompletion`, which
 * calls `POST /api/v1/claim` once and shows the case-specific result. No session yet means a
 * visitor navigated here directly (or a claim CTA elsewhere linked here without opening the
 * overlay) — render the same `ClaimEntry` used inside the `ClaimSheet` overlay, inline.
 */
import { TicketFrame } from '@receipts/ui';

import { auth } from '../../auth';
import { getEnabledAuthProviders } from '@/lib/auth-providers';
import ClaimEntry from '@/components/claim/ClaimEntry';
import ClaimCompletion from '@/components/claim/ClaimCompletion';
import { CLAIM_SIGNIN_ADMIT_LEFT, CLAIM_SIGNIN_ADMIT_RIGHT } from '@/lib/copy';

/**
 * D-J8 (WS21-T1): "Sign-in is Save." The page renders on a neutral paper `TicketFrame` — the one
 * card shell (WS16-T3) — under a "SAVE YOUR RECORD" admit bar. No gold anywhere on this ask (gold
 * is for wins). Both the signed-out sign-in entry and the signed-out→signed-in confirmation sit
 * inside the same ticket, styled on paper (ink text, AA-safe).
 */
export default async function ClaimPage() {
  const session = await auth();
  const enabledProviders = getEnabledAuthProviders();

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center px-6 py-10">
      <TicketFrame
        header={{ left: CLAIM_SIGNIN_ADMIT_LEFT, right: CLAIM_SIGNIN_ADMIT_RIGHT }}
        perf="both"
        notches
        className="w-full max-w-sm shadow-lg"
        bodyClassName="px-6 py-5"
      >
        {session?.user?.id ? (
          <ClaimCompletion />
        ) : (
          <ClaimEntry presentation="inline" enabledProviders={enabledProviders} />
        )}
      </TicketFrame>
    </main>
  );
}
