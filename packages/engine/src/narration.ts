/**
 * Narration engine (design doc §13.3, DD-9). Pure, deterministic template rendering — no LLM,
 * no randomness, no clock reads. `narrate(input)` maps a beat + its typed data to `{line,
 * emphasis?}`.
 *
 * Template strings live here (not `apps/web/lib/copy.ts`, §10.6) because `packages/engine`
 * cannot depend on `apps/web` (§4.2 dependency rules) and narration must stay a pure engine
 * function (DD-9). A later frontend/copy-consolidation task may re-home these literal strings
 * without changing behavior.
 */
import type { STREAK_MILESTONES } from '@receipts/core';
import { LONGSHOT_THRESHOLD } from '@receipts/core';

/** Style axes needed to derive a comparison clause between two fingerprints (§13.3). */
export interface StyleAxes {
  chalk: number;
  contrarian: number;
  timing: number;
}

const CLAUSE_DELTA_THRESHOLD = 0.15;

/**
 * Best-effort, deterministic clause comparing an opponent's style to the viewer's own
 * (§13.3: "opp chalk ≪ you → 'They chase longshots you'd never touch'"). Picks the axis with
 * the largest delta; falls back to a neutral clause when styles are close.
 */
export function deriveStyleClause(self: StyleAxes, opponent: StyleAxes): string {
  const deltas: Array<{ axis: 'chalk' | 'contrarian' | 'timing'; delta: number }> = [
    { axis: 'chalk', delta: opponent.chalk - self.chalk },
    { axis: 'contrarian', delta: opponent.contrarian - self.contrarian },
    { axis: 'timing', delta: opponent.timing - self.timing },
  ];

  let biggest = deltas[0];
  for (const d of deltas) {
    if (biggest === undefined || Math.abs(d.delta) > Math.abs(biggest.delta)) biggest = d;
  }
  if (biggest === undefined || Math.abs(biggest.delta) < CLAUSE_DELTA_THRESHOLD) {
    return 'Even styles — this one comes down to the picks';
  }

  const positive = biggest.delta > 0;
  switch (biggest.axis) {
    case 'chalk':
      return positive
        ? "They stick to favorites more than you do"
        : "They chase longshots you'd never touch";
    case 'contrarian':
      return positive ? 'They fade the crowd hard' : 'They ride the crowd more than you';
    case 'timing':
      return positive
        ? 'They wait till the horn to lock picks'
        : 'They lock in early, before the line moves';
  }
}

/** A win with implied entry probability of the chosen side at/below `LONGSHOT_THRESHOLD`. */
export function isCalledIt(impliedProbability: number): boolean {
  return impliedProbability <= LONGSHOT_THRESHOLD;
}

const SMALL_NUMBER_WORDS: Record<number, string> = {
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
};

function numberWord(n: number): string {
  return SMALL_NUMBER_WORDS[n] ?? String(n);
}

export interface NarrationLine {
  line: string;
  emphasis?: string;
}

export type NarrationInput =
  | {
      beat: 'nemesis_assigned';
      data: { opponentHandle: string; self: StyleAxes; opponent: StyleAxes };
    }
  | {
      beat: 'nemesis_lead_taken';
      data: { leaderHandle: string; leaderScore: number; trailerScore: number; questionsLeft: number };
    }
  | {
      beat: 'nemesis_comeback';
      data: { handle: string; deficit: number; downDay: string; levelDay: string };
    }
  | {
      beat: 'nemesis_last_day';
      data: { trailerHandle: string; leaderScore: number; trailerScore: number };
    }
  | {
      beat: 'nemesis_verdict_win';
      data: { opponentHandle: string; myScore: number; opponentScore: number };
    }
  | {
      beat: 'nemesis_verdict_loss';
      data: { winnerHandle: string; winnerScore: number; loserScore: number };
    }
  | {
      beat: 'nemesis_verdict_draw';
      data: { opponentHandle: string; myScore: number; opponentScore: number };
    }
  | { beat: 'streak_milestone'; data: { n: (typeof STREAK_MILESTONES)[number] } }
  | { beat: 'streak_busted'; data: { n: number } }
  | { beat: 'streak_freeze_used'; data: { freezesLeft: number } }
  | { beat: 'called_it'; data: { impliedProbability: number; handle: string } }
  | { beat: 'duo_formed'; data: { partnerHandle: string } }
  | {
      beat: 'duo_synergy_up';
      data: { jointHitRate: number; accuracyA: number; accuracyB: number };
    }
  | { beat: 'duo_promoted'; data: { tier: number } }
  | { beat: 'duo_relegated'; data: { tier: number } }
  | { beat: 'claim_nudge_streak'; data?: Record<string, never> }
  | { beat: 'claim_nudge_fingerprint'; data?: Record<string, never> }
  | { beat: 'reveal_reminder'; data: { n: number } };

function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/** Pure, deterministic template rendering for one narration beat (§13.3). */
export function narrate(input: NarrationInput): NarrationLine {
  switch (input.beat) {
    case 'nemesis_assigned': {
      const clause = deriveStyleClause(input.data.self, input.data.opponent);
      return {
        line: `Meet ${input.data.opponentHandle}. ${clause}. You have seven days.`,
        emphasis: input.data.opponentHandle,
      };
    }

    case 'nemesis_lead_taken': {
      const { leaderHandle, leaderScore, trailerScore, questionsLeft } = input.data;
      return {
        line: `${leaderHandle} takes the lead, ${leaderScore}–${trailerScore}, with ${questionsLeft} questions left.`,
        emphasis: leaderHandle,
      };
    }

    case 'nemesis_comeback': {
      const { handle, deficit, downDay, levelDay } = input.data;
      return {
        line: `Down ${numberWord(deficit)} on ${downDay}. Level on ${levelDay}. ${handle} is not done.`,
        emphasis: handle,
      };
    }

    case 'nemesis_last_day': {
      const { trailerHandle, leaderScore, trailerScore } = input.data;
      return {
        line: `${leaderScore}–${trailerScore}. One day left. ${trailerHandle} needs the sweep.`,
        emphasis: trailerHandle,
      };
    }

    case 'nemesis_verdict_win': {
      const { opponentHandle, myScore, opponentScore } = input.data;
      return {
        line: `You read the week better than ${opponentHandle}, ${myScore}–${opponentScore}. Rematch is open.`,
        emphasis: 'You',
      };
    }

    case 'nemesis_verdict_loss': {
      const { winnerHandle, winnerScore, loserScore } = input.data;
      return {
        line: `It wasn't close. ${winnerHandle} read the week better, ${winnerScore}–${loserScore}. Rematch is open.`,
        emphasis: winnerHandle,
      };
    }

    case 'nemesis_verdict_draw': {
      const { opponentHandle, myScore, opponentScore } = input.data;
      return {
        line: `Dead even with ${opponentHandle}, ${myScore}–${opponentScore}. Run it back.`,
      };
    }

    case 'streak_milestone': {
      return {
        line: `${input.data.n} straight days. The printer keeps printing.`,
        emphasis: String(input.data.n),
      };
    }

    case 'streak_busted': {
      return { line: `The ${input.data.n}-day streak ends here. Frame the receipt.` };
    }

    case 'streak_freeze_used': {
      return {
        line: `You missed yesterday. A freeze took the hit — ${input.data.freezesLeft} left.`,
      };
    }

    case 'called_it': {
      const { impliedProbability, handle } = input.data;
      return {
        line: `${pct(impliedProbability)}% said no chance. ${handle} said otherwise.`,
        emphasis: handle,
      };
    }

    case 'duo_formed': {
      return {
        line: `You and ${input.data.partnerHandle} just teamed up. First match starts soon.`,
        emphasis: input.data.partnerHandle,
      };
    }

    case 'duo_synergy_up': {
      const { jointHitRate, accuracyA, accuracyB } = input.data;
      const better = jointHitRate > Math.max(accuracyA, accuracyB) ? 'better' : 'worse';
      return {
        line: `You two hit ${pct(jointHitRate)}% together — ${better} than either of you alone.`,
      };
    }

    case 'duo_promoted': {
      return { line: `Promoted to Tier ${input.data.tier}. Onward.`, emphasis: `Tier ${input.data.tier}` };
    }

    case 'duo_relegated': {
      return { line: `Relegated to Tier ${input.data.tier}. Run it back next season.` };
    }

    case 'claim_nudge_streak': {
      return { line: 'Your ghost has a 3-day streak. Claim it before this device loses it.' };
    }

    case 'claim_nudge_fingerprint': {
      return { line: 'Your fingerprint is ready. Claim your record to get assigned your nemesis.' };
    }

    case 'reveal_reminder': {
      return {
        line: `Your ${input.data.n}-day streak is on the line. Pick before it locks.`,
        emphasis: String(input.data.n),
      };
    }
  }
}
