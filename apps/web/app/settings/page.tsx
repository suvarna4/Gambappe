/**
 * `/settings` (design doc §10.1: "client | me | incl. wallet linking, deletion"; WS7-T9). All
 * data is viewer-specific (`GET /me`), so this server component does no SSR data fetching of its
 * own — it exists only to read `process.env.VAPID_PUBLIC_KEY`/the `web_push` flag and the
 * enabled Auth.js providers server-side (mirrors `PushOptInButton`'s own rationale for taking
 * the key as a prop) and hand them down to the client island that does everything else.
 *
 * WS25-T1 (design-diff audit): `enabledProviders` used to be omitted entirely, so the unclaimed
 * branch of `SettingsClient`'s `ClaimEntry` silently relied on that component's own default
 * prop — safe since that default was tightened, but this surface should compute the real list
 * like `/claim` does rather than lean on the fallback.
 */
import { isFlagEnabled } from '@receipts/core';
import { getEnabledAuthProviders } from '@/lib/auth-providers';
import SettingsClient from '@/components/settings/SettingsClient';
import { settingsCopy } from '@/lib/copy';

// §4.6 flags are runtime env flags meant to flip without a rebuild — Next would otherwise
// statically prerender this page (no dynamic API used) and freeze `isFlagEnabled('web_push')` +
// `VAPID_PUBLIC_KEY` at build time, so a runtime flag flip (or restarting a standalone server
// build without rebuilding) would silently desync this page from every API route, which reads
// both fresh per request (mirrors `apps/web/app/page.tsx`'s own `force-dynamic` precedent).
export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  const vapidPublicKey =
    isFlagEnabled('web_push') && process.env.VAPID_PUBLIC_KEY
      ? process.env.VAPID_PUBLIC_KEY
      : null;

  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-10">
      <h1 className="text-lg font-semibold">{settingsCopy.heading}</h1>
      <SettingsClient vapidPublicKey={vapidPublicKey} enabledProviders={getEnabledAuthProviders()} />
    </main>
  );
}
