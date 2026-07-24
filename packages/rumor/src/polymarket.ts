/**
 * Polymarket gamma-event parsing + de-vig (docs/plans/ws27-rumor-radar.md §2E, WS27-T6).
 * Pure functions over the gamma API's event response for a "next team" event: one binary
 * market per team, each question naming the franchise in full. The fetch itself lives in
 * scripts/live-snapshot.mjs.
 *
 * De-vig is proportional normalization (as packages/sim/src/football-data.ts): YES
 * prices across the candidate teams sum to 1 + vig; dividing by the sum yields the
 * market's implied distribution over those candidates. Restricting to OUR candidate set
 * before normalizing keeps crowd and market odds on the same denominator — the only
 * fair way to compare the two distributions.
 */
import { TEAM_FULL_NAMES } from './teams.js';
import type { NbaTeam } from './teams.js';

/** The live target event (plan §1 verified facts). */
export const POLYMARKET_GAMMA_BASE = 'https://gamma-api.polymarket.com';
export const LEBRON_EVENT_SLUG = 'nba-lebron-james-next-team';

export interface TeamMarketPrice {
  team: NbaTeam;
  /** Raw YES price in [0, 1] as quoted (vig included). */
  yesPrice: number;
  volume: number;
  question: string;
}

/** Match a market question to a team by full franchise name (first match wins). */
export function teamFromQuestion(question: string): NbaTeam | null {
  const q = question.toLowerCase();
  for (const [team, names] of Object.entries(TEAM_FULL_NAMES) as [NbaTeam, string[]][]) {
    if (names.some((n) => q.includes(n))) return team;
  }
  return null;
}

/**
 * Parse the gamma `/events?slug=…` response body into per-team YES prices. Markets whose
 * question names no known franchise (e.g. "any other team") are skipped, as are rows
 * with unparseable prices — tolerant, like every other external parser in this package.
 */
export function parseGammaEvent(body: unknown): TeamMarketPrice[] {
  if (!Array.isArray(body) || body.length === 0) {
    throw new Error('polymarket: expected a non-empty event array');
  }
  const event = body[0] as Record<string, unknown>;
  const markets = event['markets'];
  if (!Array.isArray(markets)) throw new Error('polymarket: event has no markets array');

  const out: TeamMarketPrice[] = [];
  for (const raw of markets) {
    if (typeof raw !== 'object' || raw === null) continue;
    const m = raw as Record<string, unknown>;
    if (typeof m['question'] !== 'string') continue;
    const team = teamFromQuestion(m['question']);
    if (team === null) continue;
    let yesPrice: number | null = null;
    if (typeof m['outcomePrices'] === 'string') {
      try {
        const prices = JSON.parse(m['outcomePrices']) as unknown;
        if (Array.isArray(prices) && typeof prices[0] === 'string') {
          const p = Number(prices[0]);
          if (Number.isFinite(p) && p >= 0 && p <= 1) yesPrice = p;
        }
      } catch {
        // unparseable price row — skipped below
      }
    }
    if (yesPrice === null) continue;
    out.push({
      team,
      yesPrice,
      volume: typeof m['volumeNum'] === 'number' ? m['volumeNum'] : 0,
      question: m['question'],
    });
  }
  return out;
}

export interface MarketOdds {
  odds: Record<NbaTeam, number>;
  /** Raw quoted YES prices for the same candidates (vig included). */
  rawPrices: Record<NbaTeam, number>;
  /** Σ raw prices − 1 over the candidate set: the bookmaker margin on this slice. */
  vig: number;
}

/** De-vig over exactly `candidates`; a candidate with no market row prices at 0. */
export function devigMarket(
  prices: readonly TeamMarketPrice[],
  candidates: readonly NbaTeam[],
): MarketOdds {
  const rawPrices = {} as Record<NbaTeam, number>;
  for (const t of candidates) rawPrices[t] = 0;
  for (const p of prices) {
    if (candidates.includes(p.team)) rawPrices[p.team] = p.yesPrice;
  }
  const sum = candidates.reduce((s, t) => s + rawPrices[t], 0);
  if (sum <= 0) throw new Error('polymarket: no candidate has a positive price');
  const odds = {} as Record<NbaTeam, number>;
  for (const t of candidates) odds[t] = rawPrices[t] / sum;
  return { odds, rawPrices, vig: sum - 1 };
}
