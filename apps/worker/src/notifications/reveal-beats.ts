/**
 * Reveal-triggered beat selection (WS9-T3, §13.3, §7.6 `reveal:fire`). Pure, deterministic:
 * given a participant's before/after streak state + "called it" detection for ONE reveal, decide
 * which `narrate()` beats fire and what their outbox dedupe keys are. No DB, no clock reads — the
 * caller (`reveal-fire.ts`) is the only place that touches Postgres, and only calls this from
 * inside the same transaction that just flipped a question `locked` → `revealed` (§6.5
 * publication rule: this module is structurally unreachable for a still-`locked` daily).
 *
 * `dedupeKey` follows the §5.6 outbox example (`reveal:2026-07-19:profileId`), specialized per
 * beat kind so two different beats firing off the same reveal never collide:
 * `{beat}:{questionDate}:{profileId}` — EXCEPT `streak_busted`, which is death-scoped:
 * `{beat}:{deadRun.endedOn}:{profileId}`. A question-date scope would let one death notify
 * twice under out-of-order late reveals (adversarial review of PR #79, finding 1): if a lagging
 * daily reveals AFTER a later daily already hosted the wake, the backfilled history moves the
 * live run's start to the earlier date, re-satisfying the wake condition at that question's
 * reveal — same dead run, different question_date, so a date-scoped key would insert a second
 * outbox row. The dead run's `endedOn` is stable across both firings (it's the death's
 * identity), so the outbox unique constraint collapses them to one notification.
 */
import { STREAK_MILESTONES } from '@receipts/core';
import type { CompletedStreakRun } from '@receipts/db';
import { narrate, type NarrationInput } from '@receipts/engine';

/** The subset of `NarrationInput['beat']` this module can select (§13.3 reveal-triggered beats). */
export type RevealBeatKind = 'streak_milestone' | 'streak_busted' | 'streak_freeze_used' | 'called_it';

export interface RevealBeatInput {
  profileId: string;
  /** Public handle — used by the `called_it` beat's rendered line. */
  handle: string;
  /** The daily's `question_date` (YYYY-MM-DD) that just revealed — the dedupe key's date component. */
  questionDate: string;
  /** `profiles.current_streak` after this reveal's `applyStreakForParticipant` call. */
  currentStreak: number;
  /** Completed (broken) runs from the same call's replay (`StreakApplyResult.runs`) —
   * SW9-T1 (obituary-handoff §3.3(4)): the `streak_busted` beat is keyed off this replay
   * signal, never the live `profiles.current_streak` (which `streak:sweep` may have already
   * zeroed the day before, making a live-field "reset from >= 3" check silently never fire). */
  runs: CompletedStreakRun[];
  /** First counted date of the live run from the same replay (`StreakApplyResult.currentRunStartedOn`). */
  currentRunStartedOn: string | null;
  /** Whether a freeze was newly consumed to bridge this reveal's gap (`StreakApplyResult.freezeUsedForGap`). */
  freezeUsedForGap: boolean;
  /** `freeze_bank` after any consumption above (`StreakApplyResult.freezeBankAfter`). */
  freezeBankAfter: number;
  /** Win AND implied entry probability <= LONGSHOT_THRESHOLD (already computed by `reveal-fire.ts`
   * via `isCalledIt`, §6.7). */
  calledIt: boolean;
  impliedProbability: number;
}

export interface RevealBeatInstruction {
  profileId: string;
  kind: RevealBeatKind;
  /** Rendered `narrate()` output — informational; the outbox row persists `payload`, not this. */
  line: string;
  emphasis?: string;
  /** The `narrate()` input data for this beat — what gets persisted as `notifications.payload`
   * (WS9-T1's `notify:dispatch` re-renders via `narrate()` at send time, so copy changes never
   * require backfilling stored strings). */
  payload: Record<string, unknown>;
  dedupeKey: string;
}

const MILESTONES: readonly number[] = STREAK_MILESTONES;

function dedupeKey(beat: RevealBeatKind, questionDate: string, profileId: string): string {
  return `${beat}:${questionDate}:${profileId}`;
}

function toInstruction(
  input: RevealBeatInput,
  kind: RevealBeatKind,
  narration: NarrationInput,
  payload: Record<string, unknown>,
  /** Overrides the key's date component — used only by `streak_busted` (death-scoped, see the
   * module doc): the dead run's `endedOn`, not the revealing question's date. */
  dedupeDate: string = input.questionDate,
): RevealBeatInstruction {
  const rendered = narrate(narration);
  return {
    profileId: input.profileId,
    kind,
    line: rendered.line,
    emphasis: rendered.emphasis,
    payload,
    dedupeKey: dedupeKey(kind, dedupeDate, input.profileId),
  };
}

/**
 * Selects zero or more beats for one participant's reveal (§13.3 table rows: `streak_milestone`,
 * `streak_busted`, `streak_freeze_used`, `called_it`). Order is stable but not meaningful — all
 * selected beats fire independently, each with its own dedupe key, so any subset can be
 * dropped/retried without affecting the others.
 *
 * - `streak_freeze_used`: `freezeUsedForGap` is true (§6.6 "freeze auto-consumed").
 * - `streak_busted`: SW9-T1 re-key (obituary-handoff §3.3(4)): the old live-field key
 *   ("reset from >= 3", `previousStreak >= 3 && currentStreak === 1`) only fired when the break
 *   happened to be applied lazily at the reveal walk — in the normal flow `streak:sweep`
 *   (03:30 ET) zeroed `profiles.current_streak` the day before, so `previousStreak` was already
 *   0 and the beat silently never fired. Re-keyed onto the §3.2 replay-derived wake signal
 *   (`runs.length > 0 && currentRunStartedOn === questionDate`) so the notification and the
 *   payload's `broken_run` can never disagree about whether a funeral happened. §13.3's >= 3
 *   threshold DOES apply here (it's `OBITUARY_MIN_STREAK`'s value — §3.2's "no threshold
 *   server-side" is about the contract block, not this beat), against the DEAD RUN's length —
 *   which is also the narration's `n`, so notification and obituary card agree on both whether
 *   and what-sized a funeral happened.
 * - `streak_milestone`: `currentStreak` lands exactly on a `STREAK_MILESTONES` value. In every
 *   in-order flow this is mutually exclusive with `streak_busted` (milestones start at 3; at the
 *   wake the live run started `questionDate` itself, so `currentStreak` is 1). The one exception
 *   is the out-of-order late-reveal edge (see the module doc's dedupe note): a backfilled wake
 *   can arrive with `currentStreak > 1`, and if that lands exactly on a milestone the else-if
 *   lets the funeral win and skips the milestone beat — accepted: one rare missing milestone
 *   notification beats celebrating and mourning in the same breath.
 * - `called_it`: longshot win, already detected by the caller via `isCalledIt`.
 */
export function deriveRevealBeats(input: RevealBeatInput): RevealBeatInstruction[] {
  const beats: RevealBeatInstruction[] = [];

  if (input.freezeUsedForGap) {
    beats.push(
      toInstruction(
        input,
        'streak_freeze_used',
        { beat: 'streak_freeze_used', data: { freezesLeft: input.freezeBankAfter } },
        { freezesLeft: input.freezeBankAfter },
      ),
    );
  }

  // §3.2 wake condition, verbatim — same values, same source (the after-replay) as the reveal
  // payload's `broken_run` emission.
  const wake = input.runs.length > 0 && input.currentRunStartedOn === input.questionDate;
  const deadRun = wake ? input.runs.at(-1)! : null;
  if (deadRun !== null && deadRun.length >= 3) {
    beats.push(
      toInstruction(
        input,
        'streak_busted',
        { beat: 'streak_busted', data: { n: deadRun.length } },
        { n: deadRun.length },
        deadRun.endedOn, // death-scoped dedupe — see module doc
      ),
    );
  } else if (MILESTONES.includes(input.currentStreak)) {
    beats.push(
      toInstruction(
        input,
        'streak_milestone',
        { beat: 'streak_milestone', data: { n: input.currentStreak as (typeof STREAK_MILESTONES)[number] } },
        { n: input.currentStreak },
      ),
    );
  }

  if (input.calledIt) {
    beats.push(
      toInstruction(
        input,
        'called_it',
        { beat: 'called_it', data: { impliedProbability: input.impliedProbability, handle: input.handle } },
        { impliedProbability: input.impliedProbability },
      ),
    );
  }

  return beats;
}
