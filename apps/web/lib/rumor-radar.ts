/**
 * Rumor Radar panel data (docs/plans/ws27-rumor-radar.md, WS27-T8). The panel renders the
 * latest committed crowd-vs-market snapshot from `packages/rumor`'s odds history —
 * statically imported JSON, so the `/crowd` render stays DB-free and viewer-free (INV-10)
 * and the panel can never take the page down with it.
 *
 * `rumor-radar-data.json` is regenerated from
 * `packages/rumor/data/live/odds-history.jsonl` whenever a new snapshot lands (the
 * generator one-liner lives in the WS27-T8 PR description); it is committed data, same
 * philosophy as the odds history itself.
 */
import data from './rumor-radar-data.json';

export interface RumorRadarRow {
  /** Three-letter team code. */
  team: string;
  name: string;
  /** Trained-skill Reddit crowd probability in [0, 1]. */
  crowd: number;
  /** De-vigged Polymarket probability in [0, 1]. */
  market: number;
}

export interface RumorRadarView {
  /** Snapshot date (YYYY-MM-DD). */
  date: string;
  question: string;
  resolvesBy: string;
  threads: number;
  comments: number;
  /** KL(crowd ‖ market) in nats. */
  kl: number;
  /** Rows sorted by market probability, descending. */
  rows: RumorRadarRow[];
  /** True when crowd and market share the same top pick. */
  topPickAgrees: boolean;
}

export function getRumorRadar(): RumorRadarView {
  const rows = data.rows as RumorRadarRow[];
  const topCrowd = rows.reduce((best, r) => (r.crowd > best.crowd ? r : best));
  return {
    date: data.date,
    question: data.question,
    resolvesBy: data.resolvesBy,
    threads: data.threads,
    comments: data.comments,
    kl: data.kl,
    rows,
    topPickAgrees: rows[0]?.team === topCrowd.team,
  };
}
