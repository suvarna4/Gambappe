/**
 * @receipts/sim — the CPU-nemesis training simulator (docs/plans/cpu-nemesis-wbs.md, WS26-T14).
 *
 * Replays historical binary-market rows through pick policies and scores them with the SAME
 * math production uses: decisions come from policies that may wrap the real `decideCpuPick`,
 * and per-pick edge is §8.1's `(won ? 1 : 0) − implied entry prob of the chosen side`
 * verbatim. Because the decision function and the scoring function are the production ones,
 * sim results transfer to production behavior — the sim is only a data pump.
 *
 * LEAKAGE DISCIPLINE (the whole point): a `SimMarketRow` carries the outcome, but a policy's
 * `decide` receives ONLY `CpuPickInputs` (category, price, time-to-lock) — the same fields a
 * production CPU sees. Outcomes reach a policy exclusively through `observe`, AFTER its
 * decision for that row is recorded, which is exactly the walk-forward rule the WS26-T16
 * evaluation depends on.
 *
 * Replay semantics: each row is presented ONCE, at its stated `timeToLockMs`. A `wait`
 * decision (The Clock outside its window) is recorded as a wait, not retried — training rows
 * should therefore sample realistic time-to-lock values, including near-lock ones, so timing
 * personas participate.
 */
import type { CpuPersona, MarketCategory } from '@receipts/core';
import { CPU_PERSONAS } from '@receipts/core';
import { decideCpuPick } from '@receipts/engine';
import type { CpuPickDecision, CpuPickInputs } from '@receipts/engine';

/** One historical market presented to the policies. `id` is for traceability only. */
export interface SimMarketRow {
  id: string;
  category: MarketCategory;
  /** De-vigged market-implied YES probability at decision time, clamped to [0.01, 0.99]. */
  yesPrice: number;
  timeToLockMs: number;
  outcome: 'yes' | 'no';
}

/**
 * A pick policy under simulation. `decide` sees only what a production CPU sees; `observe`
 * (optional — the WS26-T9 learning hook) is called after every row with the decision and,
 * for picks, the graded result.
 */
export interface PickPolicy {
  name: string;
  decide(inputs: CpuPickInputs): CpuPickDecision;
  observe?(row: SimMarketRow, decision: CpuPickDecision, won: boolean | null): void;
}

export interface SimPickRecord {
  rowId: string;
  side: 'yes' | 'no';
  /** Implied entry probability of the chosen side (what the pick "cost"). */
  entryProb: number;
  won: boolean;
  /** §8.1 edge: (won ? 1 : 0) − entryProb. */
  edge: number;
}

export interface SimReport {
  policy: string;
  rows: number;
  picks: number;
  skips: number;
  waits: number;
  wins: number;
  /** Realized win rate over picks; null with zero picks. */
  winRate: number | null;
  /** Mean implied entry probability — the price the policy "paid" on average. A calibrated
   * policy's winRate tracks this; a persistent gap is the learnable market bias. */
  meanEntryProb: number | null;
  /** Σedge over all picks — the app's own §8.1 tiebreak quantity, the headline number. */
  edgeSum: number;
  /** Mean (entryProb − won)² over picks: calibration of the entries taken; null w/o picks. */
  brier: number | null;
  pickRate: number;
  streaks: {
    longestWin: number;
    longestLoss: number;
    /** Erdős–Rényi-style expectation ln(n·(1−p))/ln(1/p) for n Bernoulli(p) picks — the
     * believability yardstick: a realized longest-win-run far above this reads as a bot. */
    expectedLongestWin: number | null;
  };
}

export interface SimResult {
  report: SimReport;
  records: SimPickRecord[];
}

function longestRun(records: readonly SimPickRecord[], value: boolean): number {
  let longest = 0;
  let current = 0;
  for (const r of records) {
    current = r.won === value ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

function expectedLongestWinRun(n: number, p: number): number | null {
  if (n === 0 || p <= 0 || p >= 1) return null;
  const v = Math.log(n * (1 - p)) / Math.log(1 / p);
  return v > 0 ? v : 0;
}

/**
 * Deterministic replay: rows in the given order, one decision each, §8.1 grading. No RNG —
 * identical inputs and policy state produce identical reports.
 */
export function runSimulation(rows: readonly SimMarketRow[], policy: PickPolicy): SimResult {
  const records: SimPickRecord[] = [];
  let skips = 0;
  let waits = 0;

  for (const row of rows) {
    const decision = policy.decide({
      persona: 'chalk', // ignored by wrapped personas (each twin closes over its own); see below
      category: row.category,
      yesPrice: row.yesPrice,
      timeToLockMs: row.timeToLockMs,
    });
    if (decision.action === 'pick') {
      const entryProb = decision.side === 'yes' ? row.yesPrice : 1 - row.yesPrice;
      const won = decision.side === row.outcome;
      records.push({
        rowId: row.id,
        side: decision.side,
        entryProb,
        won,
        edge: (won ? 1 : 0) - entryProb,
      });
      policy.observe?.(row, decision, won);
    } else {
      if (decision.action === 'skip') skips += 1;
      else waits += 1;
      policy.observe?.(row, decision, null);
    }
  }

  const picks = records.length;
  const wins = records.filter((r) => r.won).length;
  const winRate = picks > 0 ? wins / picks : null;
  const meanEntryProb = picks > 0 ? records.reduce((s, r) => s + r.entryProb, 0) / picks : null;
  const edgeSum = records.reduce((s, r) => s + r.edge, 0);
  const brier =
    picks > 0
      ? records.reduce((s, r) => s + (r.entryProb - (r.won ? 1 : 0)) ** 2, 0) / picks
      : null;

  return {
    report: {
      policy: policy.name,
      rows: rows.length,
      picks,
      skips,
      waits,
      wins,
      winRate,
      meanEntryProb,
      edgeSum,
      brier,
      pickRate: rows.length > 0 ? picks / rows.length : 0,
      streaks: {
        longestWin: longestRun(records, true),
        longestLoss: longestRun(records, false),
        expectedLongestWin: winRate === null ? null : expectedLongestWinRun(picks, winRate),
      },
    },
    records,
  };
}

/**
 * The four production personas as sim policies — the UNTRAINED TWINS every WS26-T16
 * comparison is made against. Each wraps the real `decideCpuPick` with its persona pinned;
 * the `persona` field the sim passes in `decide` is overridden here.
 */
export function baselinePolicies(): PickPolicy[] {
  return CPU_PERSONAS.map((persona: CpuPersona): PickPolicy => ({
    name: `baseline:${persona}`,
    decide: (inputs) => decideCpuPick({ ...inputs, persona }),
  }));
}

/** Convenience: run every baseline twin over the same rows. */
export function runBaselines(rows: readonly SimMarketRow[]): SimReport[] {
  return baselinePolicies().map((policy) => runSimulation(rows, policy).report);
}
