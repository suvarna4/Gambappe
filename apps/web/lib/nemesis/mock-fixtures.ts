/**
 * SPEC-GAP(WS7-T6): seed data for the nemesis UI mock backend (see `mock-api.ts` for the
 * full explanation of why this exists). Everything here is illustrative demo content, not
 * product copy — narrative lines in particular stand in for what WS9's narration engine
 * (DD-9, §13.3) would generate at `nemesis:conclude`; this task does not author beat catalog
 * entries.
 *
 * Design choice: shared-question `lock_at` values are anchored to `now()` (via the core
 * clock, so `TEST_CLOCK` still works) rather than to real calendar days of the current ISO
 * week. That keeps the fixture's masked/unmasked mix deterministic regardless of which real
 * weekday a build or test happens to run on, while `question_date` values stay inside the
 * pairing's actual `week_start..week_start+6` range for display plausibility (§8.8).
 */
import { now } from '@receipts/core';
import type { MarketSide, PickResult, QuestionKind } from '@receipts/core';
import { addDaysToDateString, etDateString, isoWeekMonday } from './clock';
import type { SharedQuestionRecord } from './masking';
import type { RatingSummary } from './types';

// Re-exported narrowly typed helpers used only inside this fixture file.
type Pick_ = { side: MarketSide; result: PickResult } | null;

/**
 * Plain-string-ID fixture shapes (pre-validation internal state — see `masking.ts`'s header
 * comment for why). `mock-api.ts` parses these through the real `@receipts/core` response
 * schemas on the way out, which is the actual branding boundary.
 */
export interface MockProfile {
  profile_id: string;
  handle: string;
  slug: string;
  rating: RatingSummary;
}

export interface MockHistoryEntry {
  pairing_id: string;
  season_id: string;
  week_start: string;
  opponent: { profile_id: string; handle: string; slug: string };
  my_score: number;
  their_score: number;
  outcome: 'win' | 'loss' | 'draw' | 'cancelled';
  is_rematch: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

// --- Profiles -----------------------------------------------------------------------------

export const VIEWER: MockProfile = {
  profile_id: '00000000-0000-4000-8000-000000000001',
  handle: 'Raven #7734',
  slug: 'raven-7734',
  rating: { glicko_rating: 1587, glicko_rd: 92, games_count: 14, accuracy_percentile: 71 },
};

export const CURRENT_OPPONENT: MockProfile = {
  profile_id: '00000000-0000-4000-8000-000000000002',
  handle: 'Fox #4821',
  slug: 'fox-4821',
  rating: { glicko_rating: 1544, glicko_rd: 88, games_count: 11, accuracy_percentile: 63 },
};

export const PAST_NEMESIS_WIN: MockProfile = {
  profile_id: '00000000-0000-4000-8000-000000000003',
  handle: 'Wolf #1187',
  slug: 'wolf-1187',
  rating: { glicko_rating: 1498, glicko_rd: 101, games_count: 9, accuracy_percentile: 55 },
};

export const PAST_NEMESIS_LOSS: MockProfile = {
  profile_id: '00000000-0000-4000-8000-000000000004',
  handle: 'Otter #2290',
  slug: 'otter-2290',
  rating: { glicko_rating: 1622, glicko_rd: 79, games_count: 18, accuracy_percentile: 80 },
};

export const PAST_NEMESIS_DRAW: MockProfile = {
  profile_id: '00000000-0000-4000-8000-000000000005',
  handle: 'Hawk #3305',
  slug: 'hawk-3305',
  rating: { glicko_rating: 1553, glicko_rd: 95, games_count: 12, accuracy_percentile: 66 },
};

export const ALL_PROFILES: readonly MockProfile[] = [
  VIEWER,
  CURRENT_OPPONENT,
  PAST_NEMESIS_WIN,
  PAST_NEMESIS_LOSS,
  PAST_NEMESIS_DRAW,
];

// --- Season + current pairing ---------------------------------------------------------------

export const CURRENT_SEASON_ID = '00000000-0000-4000-8000-0000000000a1';
export const CURRENT_PAIRING_ID = '00000000-0000-4000-8000-0000000000b1';

export const CURRENT_WEEK_START = isoWeekMonday(etDateString(now()));

function dailyRow(
  n: number,
  offsetDaysFromNow: number,
  lockedYesterday: boolean,
  a: Pick_,
  b: Pick_,
): SharedQuestionRecord {
  const nowMs = now().getTime();
  return {
    question_id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
    slug: `mock-daily-${n}`,
    kind: 'daily' as QuestionKind,
    question_date: addDaysToDateString(CURRENT_WEEK_START, n - 1),
    lock_at: iso(nowMs + (lockedYesterday ? -1 : 1) * (Math.abs(offsetDaysFromNow) * DAY_MS)),
    a,
    b,
  };
}

/**
 * The current active pairing's shared questions. Rows 1-3 are already locked and graded
 * (mixed win/loss/no-pick, so the running score has real signal); row 4 is still open (its
 * picks masked per §9.3 even though both sides have already picked internally — nothing
 * about *whether* someone has picked leaks pre-lock either); row 5 is the week's nemesis_bonus
 * question, not yet locked.
 */
export const CURRENT_PAIRING_QUESTIONS: SharedQuestionRecord[] = [
  dailyRow(1, 3, true, { side: 'yes', result: 'win' }, { side: 'no', result: 'loss' }),
  dailyRow(2, 2, true, { side: 'no', result: 'loss' }, { side: 'yes', result: 'win' }),
  dailyRow(3, 1, true, { side: 'yes', result: 'win' }, null),
  dailyRow(4, 1, false, { side: 'no', result: 'pending' }, { side: 'yes', result: 'pending' }),
  {
    question_id: '00000000-0000-4000-8000-000000000201',
    slug: 'mock-nemesis-bonus-1',
    kind: 'nemesis_bonus' as QuestionKind,
    question_date: null,
    lock_at: iso(now().getTime() + 3 * DAY_MS),
    a: null,
    b: null,
  },
];

/** Graded-only score (§8.8: "score = Σ points", win-and-picked = 1 point). */
export const CURRENT_PAIRING_SCORE = { a: 2, b: 1 };

// --- Past pairings (nemesis history) ---------------------------------------------------------

export const PAST_PAIRING_WIN_ID = '00000000-0000-4000-8000-0000000000b2';
export const PAST_PAIRING_LOSS_ID = '00000000-0000-4000-8000-0000000000b3';
export const PAST_PAIRING_DRAW_ID = '00000000-0000-4000-8000-0000000000b4';

const twoWeeksAgo = isoWeekMonday(etDateString(new Date(now().getTime() - 14 * DAY_MS)));
const oneWeekAgo = isoWeekMonday(etDateString(new Date(now().getTime() - 7 * DAY_MS)));
const threeWeeksAgo = isoWeekMonday(etDateString(new Date(now().getTime() - 21 * DAY_MS)));

export const NEMESIS_HISTORY: MockHistoryEntry[] = [
  {
    pairing_id: PAST_PAIRING_WIN_ID,
    season_id: CURRENT_SEASON_ID,
    week_start: oneWeekAgo,
    opponent: {
      profile_id: PAST_NEMESIS_WIN.profile_id,
      handle: PAST_NEMESIS_WIN.handle,
      slug: PAST_NEMESIS_WIN.slug,
    },
    my_score: 3,
    their_score: 1,
    outcome: 'win',
    is_rematch: false,
  },
  {
    pairing_id: PAST_PAIRING_LOSS_ID,
    season_id: CURRENT_SEASON_ID,
    week_start: twoWeeksAgo,
    opponent: {
      profile_id: PAST_NEMESIS_LOSS.profile_id,
      handle: PAST_NEMESIS_LOSS.handle,
      slug: PAST_NEMESIS_LOSS.slug,
    },
    my_score: 1,
    their_score: 3,
    outcome: 'loss',
    is_rematch: false,
  },
  {
    pairing_id: PAST_PAIRING_DRAW_ID,
    season_id: CURRENT_SEASON_ID,
    week_start: threeWeeksAgo,
    opponent: {
      profile_id: PAST_NEMESIS_DRAW.profile_id,
      handle: PAST_NEMESIS_DRAW.handle,
      slug: PAST_NEMESIS_DRAW.slug,
    },
    my_score: 2,
    their_score: 2,
    outcome: 'draw',
    is_rematch: false,
  },
];

export const PAST_PAIRING_NARRATIVE: Record<string, string> = {
  [PAST_PAIRING_WIN_ID]: "Called it 3 times to Wolf #1187's 1 — statement win.",
  [PAST_PAIRING_LOSS_ID]: "Otter #2290 called it 3 times to your 1 — receipts don't lie.",
  [PAST_PAIRING_DRAW_ID]: 'Dead even with Hawk #3305 — 2 apiece.',
};

/** Convenience lookup by `profile_id`, used by rating composition in `mock-api.ts`. */
export function findProfile(profileId: string): MockProfile | undefined {
  return ALL_PROFILES.find((p) => p.profile_id === profileId);
}
