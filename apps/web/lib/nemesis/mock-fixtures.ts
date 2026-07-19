/**
 * SPEC-GAP(WS7-T6): seed data for the nemesis UI mock backend's remaining scope — the
 * rematch-request mock only (`mock-api.ts`, WS5-T5 pending). Everything here is illustrative
 * demo content, not product copy.
 *
 * WS5-T4 removed this file's former current-pairing/scoreboard fixtures
 * (`CURRENT_PAIRING_QUESTIONS`, `dailyRow`, etc.) — `/vs/[pairingId]` and `/nemesis` now read
 * real pairings via `@/lib/nemesis/service`, so those fixtures had no remaining consumer.
 * `NEMESIS_HISTORY` (a profile's past pairings) and the `MockProfile` roster stay: the
 * rematch-request mock still validates "target must be a past nemesis this season" against
 * `NEMESIS_HISTORY`, and seeds requests between roster profiles.
 */
import { now } from '@receipts/core';
import { etDateString, isoWeekMonday } from './clock';
import type { RatingSummary } from './types';

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

// --- Season ------------------------------------------------------------------------------------

export const CURRENT_SEASON_ID = '00000000-0000-4000-8000-0000000000a1';

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

/** Convenience lookup by `profile_id`, used by rating composition in `mock-api.ts`. */
export function findProfile(profileId: string): MockProfile | undefined {
  return ALL_PROFILES.find((p) => p.profile_id === profileId);
}
