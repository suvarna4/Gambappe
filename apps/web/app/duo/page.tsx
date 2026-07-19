/**
 * `/duo` (design doc §19.3 WS7-T7: "current duo status (queued/matched/active)"; not itself in
 * §10.1's route table — see `DuoHubClient`'s header for why this task adds a private hub route
 * the same way WS7-T6 added `/nemesis`). All data is viewer-specific (`GET /me`,
 * `GET /duo/current`), so this server component does no data fetching of its own — it exists
 * only to gate the whole surface behind the `duo_queue` flag (§4.6, §8.5, §9.2: every duo route
 * 404s while the flag is off, matching the API routes' own `isFlagEnabled('duo_queue')` guard)
 * and hand off to the client island that does everything else.
 */
import { notFound } from 'next/navigation';
import { isFlagEnabled } from '@receipts/core';
import DuoHubClient from '@/components/duo/DuoHubClient';
import { duoCopy } from '@/lib/copy';

// §4.6 flags are runtime env flags meant to flip without a rebuild (mirrors `/settings`'s own
// `force-dynamic` rationale) — without this, Next could statically prerender the flag check at
// build time and desync this page from the API routes, which read the flag fresh per request.
export const dynamic = 'force-dynamic';

export default function DuoHubPage() {
  if (!isFlagEnabled('duo_queue')) notFound();

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-bold">{duoCopy.hubHeading}</h1>
      <DuoHubClient />
    </main>
  );
}
