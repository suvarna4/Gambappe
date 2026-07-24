/**
 * Walk-forward saga replay (docs/plans/ws27-rumor-radar.md §2D, WS27-T4). Replays a
 * resolved saga day by day and scores each day's crowd odds against the eventual outcome.
 *
 * LEAKAGE DISCIPLINE (structural, as @receipts/sim):
 * - `decide` receives a `SagaView` — the saga WITHOUT its outcome — plus only the entries
 *   created up to that day's `asOf`. The harness slices the entry list itself; a policy
 *   cannot read evidence from the future even if it tries.
 * - The outcome reaches a policy exclusively through `observe`, which fires ONCE PER
 *   SAGA, after every day's odds are recorded. Never per day: all days of a saga share
 *   one outcome, so a per-day observe would leak the ending into the next morning's
 *   decision. The walk-forward unit is the saga; within-saga evolution is the recency
 *   decay's job, and cross-saga learning (WS27-T5) happens between sagas in
 *   chronological order.
 *
 * Scoring is the harness's job, not the policy's: log-loss and Brier are computed after
 * `decide` returns, from the same odds the policy recorded.
 */
import { aggregateCrowdOdds } from './aggregate.js';
import type { CrowdEntry, CrowdOdds } from './aggregate.js';
import type { SagaDef } from './sagas.js';
import type { RumorSkill } from './skill.js';
import type { NbaTeam } from './teams.js';

/** What a policy is allowed to know about a saga at decision time: no outcome. */
export interface SagaView {
  id: string;
  player: string;
  candidates: NbaTeam[];
  from: string;
  to: string;
}

export interface RumorPolicy {
  name: string;
  /** Compute the day's odds from pre-`asOf` evidence only. */
  decide(view: SagaView, entries: readonly CrowdEntry[], asOf: number): CrowdOdds;
  /** Learning hook — the only channel the outcome ever reaches a policy through. */
  observe?(view: SagaView, report: SagaReplayReport, outcome: NbaTeam): void;
}

export interface DayScore {
  /** YYYY-MM-DD; odds are computed as of the END of this day (UTC). */
  day: string;
  odds: CrowdOdds;
  /** −ln p(outcome) for this day's odds. */
  logLoss: number;
  /** Σ (p_i − 1{i=outcome})² over candidates. */
  brier: number;
  /** 1-based rank of the eventual outcome in this day's odds. */
  outcomeRank: number;
}

export interface SagaReplayReport {
  sagaId: string;
  policy: string;
  days: DayScore[];
  /** The last replay day's score — the "eve of the decision" verdict. */
  final: DayScore;
  meanLogLoss: number;
}

const DAY_S = 86_400;
const dayEpoch = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000;
const epochDay = (epoch: number): string => new Date(epoch * 1000).toISOString().slice(0, 10);

/** Replay days: `from` .. the day BEFORE `resolvedAt` — announcement day never counts. */
export function replayDays(saga: Pick<SagaDef, 'from' | 'resolvedAt'>): string[] {
  const days: string[] = [];
  for (let t = dayEpoch(saga.from); t < dayEpoch(saga.resolvedAt); t += DAY_S) {
    days.push(epochDay(t));
  }
  return days;
}

export function scoreOdds(odds: CrowdOdds, outcome: NbaTeam): Omit<DayScore, 'day' | 'odds'> {
  const candidates = Object.keys(odds.odds) as NbaTeam[];
  const p = odds.odds[outcome] ?? 0;
  const logLoss = -Math.log(Math.max(p, 1e-9));
  const brier = candidates.reduce((s, t) => s + (odds.odds[t]! - (t === outcome ? 1 : 0)) ** 2, 0);
  const outcomeRank = 1 + candidates.filter((t) => odds.odds[t]! > p).length;
  return { logLoss, brier, outcomeRank };
}

/**
 * Replay one saga through one policy. `entries` may be in any order and may extend past
 * the window — the harness sorts and slices. Deterministic for deterministic policies.
 */
export function replaySaga(
  saga: SagaDef,
  entries: readonly CrowdEntry[],
  policy: RumorPolicy,
): SagaReplayReport {
  const view: SagaView = {
    id: saga.id,
    player: saga.player,
    candidates: [...saga.candidates],
    from: saga.from,
    to: saga.to,
  };
  const sorted = [...entries].sort((a, b) => a.createdUtc - b.createdUtc);

  const days: DayScore[] = [];
  let cursor = 0;
  for (const day of replayDays(saga)) {
    const asOf = dayEpoch(day) + DAY_S; // end of the replay day
    while (cursor < sorted.length && sorted[cursor]!.createdUtc <= asOf) cursor += 1;
    // Structural slice: decide can only ever see evidence that existed by asOf.
    const visible = sorted.slice(0, cursor);
    const odds = policy.decide(view, visible, asOf);
    days.push({ day, odds, ...scoreOdds(odds, saga.outcome) });
  }

  const final = days.at(-1);
  if (!final) throw new Error(`saga ${saga.id} has an empty replay window`);
  const report: SagaReplayReport = {
    sagaId: saga.id,
    policy: policy.name,
    days,
    final,
    meanLogLoss: days.reduce((s, d) => s + d.logLoss, 0) / days.length,
  };
  policy.observe?.(view, report, saga.outcome);
  return report;
}

/** A RumorSkill as a (non-learning) policy — the T5 frozen/untrained twin. */
export function skillPolicy(skill: RumorSkill, name?: string): RumorPolicy {
  return {
    name: name ?? `skill:${skill.cutoff}`,
    decide: (view, entries, asOf) => aggregateCrowdOdds(entries, skill, view.candidates, asOf),
  };
}
