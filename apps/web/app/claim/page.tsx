/**
 * `/claim` — design doc §10.1: "SSR — Auth + claim flow + placement offer." The canonical
 * post-auth landing (§6.3): every sign-in action in `ClaimEntry` redirects here. A session
 * already present means we're on the way back from Auth.js — render `ClaimCompletion`, which
 * calls `POST /api/v1/claim` once and shows the case-specific result. No session yet means a
 * visitor navigated here directly (or a claim CTA elsewhere linked here without opening the
 * overlay) — render the same `ClaimEntry` used inside the `ClaimSheet` overlay, inline.
 */
import { auth } from '../../auth';
import { getEnabledAuthProviders } from '@/lib/auth-providers';
import ClaimEntry from '@/components/claim/ClaimEntry';
import ClaimCompletion from '@/components/claim/ClaimCompletion';

export default async function ClaimPage() {
  const session = await auth();
  const enabledProviders = getEnabledAuthProviders();

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center px-6 py-10">
      {session?.user?.id ? <ClaimCompletion /> : <ClaimEntry presentation="inline" enabledProviders={enabledProviders} />}
    </main>
  );
}
