/**
 * Fact ledger (WS27-T9, owner request 2026-07-24): citation-backed candidate caps.
 *
 * Why this exists: sentiment aggregation can weigh what the crowd SAYS, but it cannot
 * represent "this candidate is eliminated" — when the Lakers officially announced
 * LeBron's exit, the crowd read still carried LAL at 9.2% (mention ≠ belief residue)
 * while the market sat at 0.3%. Pretending sentiment discovered the fact would be
 * dishonest; encoding it as an explicit, cited, reviewable ledger entry is not.
 *
 * Mechanics: the ledger is committed JSON (data/live/fact-ledger.json), applied AFTER
 * aggregation as a pure cap-and-renormalize step. A fact caps one team's crowd
 * probability at `capAt`; the excess mass is redistributed proportionally across the
 * uncapped candidates. `raw` is never touched — the audit trail of what the crowd
 * actually said survives, and every history row records which facts bound.
 */
import type { CrowdOdds } from './aggregate.js';
import { isNbaTeam } from './teams.js';
import type { NbaTeam } from './teams.js';

export interface FactEntry {
  team: NbaTeam;
  /** Crowd-probability ceiling this fact imposes, in (0, 1). */
  capAt: number;
  reason: string;
  /** Citation — where a reviewer can verify the fact. */
  source: string;
  /** YYYY-MM-DD the fact entered the ledger. */
  addedAt: string;
}

export interface FactLedger {
  version: 1;
  facts: FactEntry[];
}

export function isFactLedger(value: unknown): value is FactLedger {
  if (typeof value !== 'object' || value === null) return false;
  const l = value as Record<string, unknown>;
  if (l['version'] !== 1 || !Array.isArray(l['facts'])) return false;
  return (l['facts'] as unknown[]).every((f) => {
    if (typeof f !== 'object' || f === null) return false;
    const e = f as Record<string, unknown>;
    return (
      isNbaTeam(e['team']) &&
      typeof e['capAt'] === 'number' &&
      e['capAt'] > 0 &&
      e['capAt'] < 1 &&
      typeof e['reason'] === 'string' &&
      e['reason'].length > 0 &&
      typeof e['source'] === 'string' &&
      e['source'].length > 0 &&
      typeof e['addedAt'] === 'string'
    );
  });
}

export interface FactApplication {
  odds: CrowdOdds;
  /** The facts that actually bound (cap below the aggregated probability). */
  applied: FactEntry[];
}

/**
 * Cap-and-renormalize. For each candidate with ledger facts, the effective cap is the
 * MINIMUM capAt among them; a fact "applies" only when it binds. Excess mass moves to
 * the uncapped candidates in proportion to their current probabilities (uniformly if
 * they hold zero mass). Deterministic; the input odds object is never mutated.
 */
export function applyFactLedger(
  odds: CrowdOdds,
  ledger: FactLedger,
  candidates: readonly NbaTeam[],
): FactApplication {
  const capFor = new Map<NbaTeam, { cap: number; fact: FactEntry }>();
  for (const fact of ledger.facts) {
    if (!candidates.includes(fact.team)) continue;
    const existing = capFor.get(fact.team);
    if (!existing || fact.capAt < existing.cap) capFor.set(fact.team, { cap: fact.capAt, fact });
  }

  const applied: FactEntry[] = [];
  const next = {} as Record<NbaTeam, number>;
  let excess = 0;
  for (const team of candidates) {
    const p = odds.odds[team] ?? 0;
    const capped = capFor.get(team);
    if (capped && p > capped.cap) {
      next[team] = capped.cap;
      excess += p - capped.cap;
      applied.push(capped.fact);
    } else {
      next[team] = p;
    }
  }

  if (applied.length > 0 && excess > 0) {
    const uncapped = candidates.filter((t) => !capFor.has(t));
    if (uncapped.length > 0) {
      const uncappedMass = uncapped.reduce((s, t) => s + next[t], 0);
      for (const t of uncapped) {
        next[t] += uncappedMass > 0 ? excess * (next[t] / uncappedMass) : excess / uncapped.length;
      }
    } else {
      // Every candidate is capped: renormalize what remains so the odds stay a distribution.
      const total = candidates.reduce((s, t) => s + next[t], 0);
      for (const t of candidates) next[t] = total > 0 ? next[t] / total : 1 / candidates.length;
    }
  }

  return {
    odds: { ...odds, odds: next },
    applied,
  };
}
