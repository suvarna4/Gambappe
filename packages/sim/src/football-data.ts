/**
 * football-data.co.uk ingest (docs/plans/cpu-nemesis-wbs.md, WS26-T15 — football-only v1).
 *
 * Each match becomes ONE binary market, framed exactly like an app question: "Will the home
 * side win?" — YES price = proportionally de-vigged home probability from a 1X2 closing-odds
 * triple, outcome from full-time result (`H` → yes; `D`/`A` → no).
 *
 * Odds ladder (first triple fully present wins): Pinnacle closing → Bet365 closing → market-
 * average closing → Pinnacle → Bet365 → market average. Closing columns exist in archived
 * seasons from ~2019 on; older files fall through to the plain columns.
 *
 * The dataset has no per-match decision timestamp, so `timeToLockMs` is SYNTHESIZED
 * deterministically (FNV-1a of the row id → a value across [5 min, 6 h]) purely so timing
 * personas participate in replay. It carries no information about the match — the same
 * no-informational-edge posture as production.
 *
 * CUTOFF DISCIPLINE: every artifact built from these rows must carry its cutoff, and
 * `splitByCutoff` is the ONLY sanctioned way to slice — it compares kickoff DATES, keeping
 * strictly-before rows, so a 2026-05-31 cutoff can never see a World Cup match.
 */
import { YES_PRICE_MAX, YES_PRICE_MIN } from '@receipts/core';
import type { SimMarketRow } from './index.js';

export interface FootballMatchRow extends SimMarketRow {
  /** Kickoff date, YYYY-MM-DD — the cutoff key. */
  kickoffDate: string;
}

export interface FootballDataset {
  source: string;
  /** Rows are usable for training/tuning ONLY when kickoffDate < cutoff. */
  cutoff: string;
  generatedAt: string;
  rows: FootballMatchRow[];
}

const ODDS_LADDER: ReadonlyArray<[string, string, string]> = [
  ['PSCH', 'PSCD', 'PSCA'],
  ['B365CH', 'B365CD', 'B365CA'],
  ['AvgCH', 'AvgCD', 'AvgCA'],
  ['PSH', 'PSD', 'PSA'],
  ['B365H', 'B365D', 'B365A'],
  ['AvgH', 'AvgD', 'AvgA'],
];

function clamp(p: number): number {
  return Math.min(YES_PRICE_MAX, Math.max(YES_PRICE_MIN, p));
}

/** Proportional de-vig: implied probs 1/odds, normalized to sum 1. */
export function devigHomeProb(home: number, draw: number, away: number): number | null {
  if (!(home > 1) || !(draw > 1) || !(away > 1)) return null; // decimal odds are always > 1
  const rawH = 1 / home;
  const total = rawH + 1 / draw + 1 / away;
  return clamp(rawH / total);
}

/** `dd/mm/yy` or `dd/mm/yyyy` → `YYYY-MM-DD`; null when malformed. Two-digit years are
 * 20xx — the corpus starts in the 1990s but we never ingest seasons before 2000. */
function parseUkDate(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, y] = m;
  const yyyy = y!.length === 2 ? `20${y}` : y!;
  return `${yyyy}-${mm}-${dd}`;
}

/** FNV-1a over the id → deterministic pseudo-spread, mapped into [5 min, 6 h]. */
export function synthesizeTimeToLockMs(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const MIN = 5 * 60_000;
  const MAX = 6 * 60 * 60_000;
  return MIN + (hash % (MAX - MIN));
}

/** Minimal CSV split honoring the format's absence of embedded commas in relevant fields. */
function splitCsvLine(line: string): string[] {
  return line.split(',').map((c) => c.trim());
}

/**
 * Parse one football-data.co.uk season CSV into match rows. Malformed rows (bad date, no
 * complete odds triple, unknown result token) are SKIPPED, never guessed — count the drop
 * via `rows.length` against the raw line count if ingest telemetry is wanted.
 */
export function parseFootballDataCsv(csv: string): FootballMatchRow[] {
  const lines = csv
    .replace(/^﻿/, '') // BOM on current-season files
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]!);
  const col = new Map(header.map((name, i) => [name, i]));
  const get = (cells: string[], name: string): string | undefined => {
    const i = col.get(name);
    return i === undefined ? undefined : cells[i];
  };

  const rows: FootballMatchRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]!);
    const div = get(cells, 'Div');
    const dateRaw = get(cells, 'Date');
    const home = get(cells, 'HomeTeam');
    const away = get(cells, 'AwayTeam');
    const ftr = get(cells, 'FTR');
    if (!div || !dateRaw || !home || !away || !ftr) continue;
    const kickoffDate = parseUkDate(dateRaw);
    if (!kickoffDate) continue;
    if (ftr !== 'H' && ftr !== 'D' && ftr !== 'A') continue;

    let yesPrice: number | null = null;
    for (const [h, d, a] of ODDS_LADDER) {
      const oh = Number(get(cells, h));
      const od = Number(get(cells, d));
      const oa = Number(get(cells, a));
      if (Number.isFinite(oh) && Number.isFinite(od) && Number.isFinite(oa)) {
        yesPrice = devigHomeProb(oh, od, oa);
        if (yesPrice !== null) break;
      }
    }
    if (yesPrice === null) continue;

    const id = `${div}:${kickoffDate}:${home} v ${away}`;
    rows.push({
      id,
      category: 'sports',
      yesPrice,
      timeToLockMs: synthesizeTimeToLockMs(id),
      outcome: ftr === 'H' ? 'yes' : 'no',
      kickoffDate,
    });
  }
  return rows;
}

/**
 * The only sanctioned slicer: `train` is strictly before `cutoff`; everything at/after goes
 * to `held`. Used twice — train/validation (validationStart as the cutoff) and the hard
 * pre-World-Cup wall (2026-05-31).
 */
export function splitByCutoff(
  rows: readonly FootballMatchRow[],
  cutoff: string,
): { train: FootballMatchRow[]; held: FootballMatchRow[] } {
  const train: FootballMatchRow[] = [];
  const held: FootballMatchRow[] = [];
  for (const row of rows) {
    (row.kickoffDate < cutoff ? train : held).push(row);
  }
  return { train, held };
}

export function buildDataset(
  rows: FootballMatchRow[],
  source: string,
  cutoff: string,
  generatedAt: Date,
): FootballDataset {
  const { train } = splitByCutoff(rows, cutoff);
  return { source, cutoff, generatedAt: generatedAt.toISOString(), rows: train };
}
