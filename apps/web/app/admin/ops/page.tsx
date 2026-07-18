/**
 * `/admin/ops` — the ops dashboard (§15.5, WS10-T5). Read-only, no audit_log row (only
 * mutations are audited, §15.1). Gated entirely by middleware.ts. A plain server component:
 * everything here is a point-in-time read at request time, so there's no need for the
 * client-fetch + `?token=` forwarding pattern the curation UI (WS10-T2) needed for its live
 * preview — a server component reads the DB directly, no second HTTP hop to re-authenticate.
 */
import { now, VENUE } from '@receipts/core';
import { getHeartbeats, getVenueLastPriceUpdate, listOverdueRevealQuestions, listQuestionsForWindow } from '@receipts/db';
import { getDb, ensureRedisConnected, getRedis } from '@/lib/stores';
import { computeJobHealth, etDateString, etDayWindow } from '@/lib/ops-dashboard';

export const dynamic = 'force-dynamic';

/** §7.5: "venue_degraded ... set after 3 consecutive tick failures." */
function degradedKey(venue: string): string {
  return `venue_degraded:${venue}`;
}

/** §16.1: "question past reveal_at + 60 min unsettled." */
const OVERDUE_REVEAL_MINUTES = 60;

const RUNBOOKS = [
  { title: 'Question-day checklist', slug: 'question-day-checklist' },
  { title: 'Venue outage', slug: 'venue-outage' },
  { title: 'Settlement dispute', slug: 'settlement-dispute' },
  { title: 'Launch drill', slug: 'launch-drill' },
];

function fmt(d: Date | null): string {
  return d ? d.toISOString() : 'never';
}

interface OpsDashboardPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function OpsDashboardPage({ searchParams }: OpsDashboardPageProps) {
  const { token } = await searchParams;
  const db = getDb();
  const at = now();
  const today = etDateString(at);
  const dayWindow = etDayWindow(today);

  const [heartbeatRows, venuePrices, todayQuestions, overdueQuestions] = await Promise.all([
    getHeartbeats(db),
    getVenueLastPriceUpdate(db),
    listQuestionsForWindow(db, dayWindow.start, dayWindow.end),
    listOverdueRevealQuestions(db, at, OVERDUE_REVEAL_MINUTES),
  ]);

  const jobHealth = computeJobHealth(heartbeatRows, at);

  const redis = await ensureRedisConnected(getRedis());
  const degradedFlags = await Promise.all(VENUE.map((v) => redis.exists(degradedKey(v))));
  const venueStatus = VENUE.map((venue, i) => ({
    venue,
    degraded: degradedFlags[i] === 1,
    lastPriceUpdate: venuePrices.find((p) => p.venue === venue)?.lastUpdatedAt ?? null,
  }));

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <h1 className="text-2xl font-bold">Ops dashboard</h1>

      {overdueQuestions.length > 0 && (
        <section className="border-loss bg-loss/10 rounded-md border px-4 py-3">
          <p className="text-loss text-sm font-semibold">
            {overdueQuestions.length} question{overdueQuestions.length > 1 ? 's' : ''} overdue for reveal
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {overdueQuestions.map((q) => (
              <li key={q.id}>
                {q.slug ?? q.id} — reveal_at {fmt(q.revealAt)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Job health</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted">
              <th className="pr-4">Job</th>
              <th className="pr-4">Last success</th>
              <th className="pr-4">Last error</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobHealth.map((job) => (
              <tr key={job.jobName}>
                <td className="pr-4 font-mono">{job.jobName}</td>
                <td className="pr-4">{fmt(job.lastSuccessAt)}</td>
                <td className="pr-4">{fmt(job.lastErrorAt)}</td>
                <td className={job.stale || job.erroring ? 'text-loss' : ''}>
                  {job.stale ? 'stale' : job.erroring ? 'erroring' : 'ok'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Venue adapter status</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted">
              <th className="pr-4">Venue</th>
              <th className="pr-4">Degraded</th>
              <th>Last price update</th>
            </tr>
          </thead>
          <tbody>
            {venueStatus.map((v) => (
              <tr key={v.venue}>
                <td className="pr-4 font-mono uppercase">{v.venue}</td>
                <td className={`pr-4 ${v.degraded ? 'text-loss' : ''}`}>{v.degraded ? 'yes' : 'no'}</td>
                <td>{fmt(v.lastPriceUpdate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Today&apos;s question timeline ({today})</h2>
        {todayQuestions.length === 0 && <p className="text-muted text-sm">No questions open today.</p>}
        <table className="w-full text-left text-sm">
          <tbody>
            {todayQuestions.map((q) => (
              <tr key={q.id}>
                <td className="pr-4 font-mono">{q.slug ?? q.id}</td>
                <td className="pr-4">{q.kind}</td>
                <td className="pr-4">{q.status}</td>
                <td>
                  open {fmt(q.openAt)} · lock {fmt(q.lockAt)} · reveal {fmt(q.revealAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="text-muted text-sm font-semibold uppercase">Runbooks</h2>
        <ul className="space-y-1 text-sm">
          {RUNBOOKS.map((r) => {
            const href = token
              ? `/api/admin/runbooks/${r.slug}?token=${encodeURIComponent(token)}`
              : `/api/admin/runbooks/${r.slug}`;
            return (
              <li key={r.slug}>
                <a className="underline" href={href}>
                  {r.title}
                </a>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
