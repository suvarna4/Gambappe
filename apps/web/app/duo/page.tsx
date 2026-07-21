/**
 * `/duo` (design doc §19.3 WS7-T7: "current duo status (queued/matched/active)"; not itself in
 * §10.1's route table — see `DuoHubClient`'s header for why this task adds a private hub route
 * the same way WS7-T6 added `/nemesis`). All data is viewer-specific (`GET /me`,
 * `GET /duo/current`), so this server component does no data fetching of its own.
 *
 * WS17-T2 (journeys plan §5): the body (heading + `DuoHubClient`) and the `duo_queue` flag gate
 * both live in the co-located `DuoRoom` server component now, so the segmented `/rivals?tab=duo`
 * hub can reuse the exact same surface (and inherit the same flag gating). This page just wraps
 * `DuoRoom` in the same `<main>` as before — its rendered DOM (and `/duo`'s 404-while-flag-off
 * behavior) is unchanged.
 */
import { DuoRoom } from './DuoRoom';

// §4.6 flags are runtime env flags meant to flip without a rebuild (mirrors `/settings`'s own
// `force-dynamic` rationale) — without this, Next could statically prerender the flag check at
// build time and desync this page from the API routes, which read the flag fresh per request.
export const dynamic = 'force-dynamic';

export default function DuoHubPage() {
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-10">
      <DuoRoom />
    </main>
  );
}
