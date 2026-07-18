/**
 * `/admin/metrics` — the admin metrics page (§13.3, §16.3, WS13-T3): "renders all §16.3
 * metrics with 7/28-day views." Read-only server component, same pattern as the ops
 * dashboard (WS10-T5) — no `audit_log` row (only mutations are audited, §15.1), no client
 * fetch layer needed since everything is a point-in-time DB read at request time.
 */
import { SCHEDULE_TZ } from '@receipts/core';
import { listMetricRollupsForRange } from '@receipts/db';
import { getDb } from '@/lib/stores';
import { summarizeMetrics, type MetricWindowDef } from '@/lib/metrics-page';

export const dynamic = 'force-dynamic';

const WINDOWS: MetricWindowDef[] = [
  { label: '7d', days: 7 },
  { label: '28d', days: 28 },
];
const WIDEST_WINDOW_DAYS = Math.max(...WINDOWS.map((w) => w.days));

/** The ET calendar date (YYYY-MM-DD) containing the given instant (§4.3). */
function etDateString(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return `${map['year']}-${map['month']}-${map['day']}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function fmtValue(v: number | null): string {
  if (v === null) return '—';
  // Rates live in [0,1] almost everywhere in §16.3; counts are integers. Round generously
  // rather than trying to know per-metric which is which.
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

function fmtDims(dims: Record<string, unknown>): string {
  const entries = Object.entries(dims);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(', ');
}

export default async function MetricsPage() {
  const db = getDb();
  const today = etDateString(new Date());
  const rangeStart = addDaysToDateStr(today, -(WIDEST_WINDOW_DAYS - 1));

  const rows = await listMetricRollupsForRange(db, rangeStart, today);
  const summaries = summarizeMetrics(
    rows.map((r) => ({ date: r.date, metric: r.metric, value: r.value, dims: r.dims as Record<string, unknown> })),
    WINDOWS,
    today,
  );

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-bold">Metrics</h1>
      <p className="text-muted text-sm">
        §16.3 product metrics, averaged over trailing windows ending {today} (ET).
      </p>

      {summaries.length === 0 && (
        <p className="text-muted text-sm">
          No metric_rollups rows yet — the analytics:rollup job writes these nightly.
        </p>
      )}

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-muted">
            <th className="pr-4">Metric</th>
            <th className="pr-4">Dims</th>
            <th className="pr-4">Latest</th>
            {WINDOWS.map((w) => (
              <th key={w.label} className="pr-4">
                {w.label} avg
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.seriesKey}>
              <td className="pr-4 font-mono">{s.metric}</td>
              <td className="pr-4 text-xs">{fmtDims(s.dims)}</td>
              <td className="pr-4">
                {fmtValue(s.latestValue)}
                {s.latestDate && s.latestDate !== today && (
                  <span className="text-muted text-xs"> (as of {s.latestDate})</span>
                )}
              </td>
              {WINDOWS.map((w) => (
                <td key={w.label} className="pr-4">
                  {s.windows[w.label] ? `${fmtValue(s.windows[w.label]!.average)} (${s.windows[w.label]!.days}d)` : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
