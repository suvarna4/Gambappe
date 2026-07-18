/**
 * Admin metrics page (§13.3/§16.3, WS13-T3): "renders all §16.3 metrics with 7/28-day
 * views." A metric can have several `dims` rows per date (e.g. one per nemesis trigger, or
 * one per K-factor chain stage) — each distinct (metric, dims) pair gets its own summary row,
 * keyed by the dims object's stable JSON serialization. Every metric is summarized the same
 * way (average over the window) rather than special-casing rates vs. counts vs. snapshots —
 * a uniform, if imperfect, rule beats a growing per-metric exception table for a first cut.
 */

export interface MetricRollupLike {
  date: string;
  metric: string;
  value: number;
  dims: Record<string, unknown>;
}

export interface MetricWindowSummary {
  metric: string;
  dims: Record<string, unknown>;
  /** Stable key identifying this (metric, dims) series across windows. */
  seriesKey: string;
  latestValue: number | null;
  latestDate: string | null;
  windows: Record<string, { average: number; days: number } | null>;
}

/** Stable across key insertion order — dims objects are built consistently by the rollup job. */
function seriesKey(metric: string, dims: Record<string, unknown>): string {
  const sortedEntries = Object.entries(dims).sort(([a], [b]) => a.localeCompare(b));
  return `${metric}|${JSON.stringify(sortedEntries)}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface MetricWindowDef {
  label: string;
  days: number;
}

/**
 * Summarizes `rows` (assumed to already cover at least the widest window ending on
 * `asOfDate`) into one row per (metric, dims) series, with an average-value summary for
 * each requested trailing window.
 */
export function summarizeMetrics(
  rows: MetricRollupLike[],
  windows: MetricWindowDef[],
  asOfDate: string,
): MetricWindowSummary[] {
  const bySeries = new Map<string, MetricRollupLike[]>();
  for (const row of rows) {
    const key = seriesKey(row.metric, row.dims);
    const list = bySeries.get(key) ?? [];
    list.push(row);
    bySeries.set(key, list);
  }

  const summaries: MetricWindowSummary[] = [];
  for (const [key, seriesRows] of bySeries) {
    seriesRows.sort((a, b) => a.date.localeCompare(b.date));
    const latest = seriesRows.at(-1) ?? null;

    const windowResults: MetricWindowSummary['windows'] = {};
    for (const w of windows) {
      const windowStart = addDaysToDateStr(asOfDate, -(w.days - 1));
      const inWindow = seriesRows.filter((r) => r.date >= windowStart && r.date <= asOfDate);
      windowResults[w.label] =
        inWindow.length > 0
          ? { average: inWindow.reduce((sum, r) => sum + r.value, 0) / inWindow.length, days: inWindow.length }
          : null;
    }

    summaries.push({
      metric: seriesRows[0]!.metric,
      dims: seriesRows[0]!.dims,
      seriesKey: key,
      latestValue: latest?.value ?? null,
      latestDate: latest?.date ?? null,
      windows: windowResults,
    });
  }

  summaries.sort((a, b) => a.metric.localeCompare(b.metric) || a.seriesKey.localeCompare(b.seriesKey));
  return summaries;
}
