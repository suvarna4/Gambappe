/**
 * Mode tables (design doc §5.5): nemesis pairings, rematches, duos, placement.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  timestamp,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  duoMatchStatusEnum,
  duoStatusEnum,
  marketCategoryEnum,
  marketSideEnum,
  pairingStatusEnum,
  queueStatusEnum,
  rematchStatusEnum,
} from './enums.js';
import { profiles } from './identity.js';
import { questions } from './markets.js';
import { seasons } from './engine.js';

/** `nemesis_pairings` (§5.5). Canonical order: a < b by uuid. */
export const nemesisPairings = pgTable(
  'nemesis_pairings',
  {
    id: uuid('id').primaryKey(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    /** The Monday. */
    weekStart: date('week_start').notNull(),
    profileAId: uuid('profile_a_id')
      .notNull()
      .references(() => profiles.id),
    profileBId: uuid('profile_b_id')
      .notNull()
      .references(() => profiles.id),
    status: pairingStatusEnum('status').notNull(),
    /** Shared-question points (§8.8). */
    scoreA: smallint('score_a').notNull().default(0),
    scoreB: smallint('score_b').notNull().default(0),
    /** Tiebreak totals. */
    edgeA: numeric('edge_a', { precision: 8, scale: 5, mode: 'number' }).notNull().default(0),
    edgeB: numeric('edge_b', { precision: 8, scale: 5, mode: 'number' }).notNull().default(0),
    /** Null = draw or not finished. */
    winnerProfileId: uuid('winner_profile_id').references(() => profiles.id),
    /** Narration data bundle (§13.3), incl. rating_before snapshots (§6.5). */
    verdict: jsonb('verdict'),
    isRematch: boolean('is_rematch').notNull().default(false),
    /** Idempotency guard: weekly Glicko batch skips pairings where non-null (§8.3). */
    ratingAppliedAt: timestamp('rating_applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One pairing per profile per week (§5.5; also enforced in assignment code). */
    uniqueIndex('nemesis_pairings_week_a_uq').on(t.seasonId, t.weekStart, t.profileAId),
    uniqueIndex('nemesis_pairings_week_b_uq').on(t.seasonId, t.weekStart, t.profileBId),
    index('nemesis_pairings_profile_a_idx').on(t.profileAId),
    index('nemesis_pairings_profile_b_idx').on(t.profileBId),
    index('nemesis_pairings_status_week_idx').on(t.status, t.weekStart),
  ],
);

/**
 * `pairing_questions` — BONUS questions only (§5.5). The week's dailies are derived by date,
 * never stored.
 */
export const pairingQuestions = pgTable(
  'pairing_questions',
  {
    pairingId: uuid('pairing_id')
      .notNull()
      .references(() => nemesisPairings.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
  },
  (t) => [primaryKey({ columns: [t.pairingId, t.questionId] })],
);

/** `rematch_requests` (§5.5). Expired by the next `nemesis:assign` run if not mutual. */
export const rematchRequests = pgTable(
  'rematch_requests',
  {
    id: uuid('id').primaryKey(),
    requesterProfileId: uuid('requester_profile_id')
      .notNull()
      .references(() => profiles.id),
    targetProfileId: uuid('target_profile_id')
      .notNull()
      .references(() => profiles.id),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => seasons.id),
    status: rematchStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rematch_requests_target_idx').on(t.targetProfileId, t.status)],
);

/**
 * `pairing_reactions` (SW10-T4, wiring-gaps doc §4 — swipe-ux-plan §2.9 SW5-T4's preset stamp
 * "trash talk" reactions). Deliberately a SEPARATE table from `schema/social.ts`'s generic
 * `reactions` (used for `question`/`duo_match` toggle reactions): pairing reactions are capped
 * at one per player per ET calendar DAY (not per emoji), and a same-day repost REPLACES the
 * day's stamp rather than toggling it — a shape the generic table's
 * `(context_kind, context_id, profile_id, emoji)` unique index can't express. `emoji` holds a
 * `PAIRING_REACTION_SET` text preset (API-enforced via `pairingReactionEmojiSchema`), kept as
 * plain `text` for the same reason `reactions.emoji` is — no DB-level enum coupling to a
 * `core/config.ts` value.
 */
export const pairingReactions = pgTable(
  'pairing_reactions',
  {
    id: uuid('id').primaryKey(),
    pairingId: uuid('pairing_id')
      .notNull()
      .references(() => nemesisPairings.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    emoji: text('emoji').notNull(),
    /** ET calendar day (`etDateString`, DD-1) this stamp is FOR — the "per day" unit the unique
     * index below enforces; a same-day repost updates this row rather than inserting a new one. */
    reactionDate: date('reaction_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pairing_reactions_pairing_profile_date_uq').on(
      t.pairingId,
      t.profileId,
      t.reactionDate,
    ),
    index('pairing_reactions_pairing_date_idx').on(t.pairingId, t.reactionDate),
  ],
);

/** `duos` (§5.5). Canonical order a < b; team Glicko defaults 1500/350/0.06. */
export const duos = pgTable(
  'duos',
  {
    id: uuid('id').primaryKey(),
    profileAId: uuid('profile_a_id')
      .notNull()
      .references(() => profiles.id),
    profileBId: uuid('profile_b_id')
      .notNull()
      .references(() => profiles.id),
    status: duoStatusEnum('status').notNull(),
    /** 1 = bottom (§8.10). */
    tier: smallint('tier').notNull().default(1),
    glickoRating: real('glicko_rating').notNull().default(1500),
    glickoRd: real('glicko_rd').notNull().default(350),
    glickoVol: real('glicko_vol').notNull().default(0.06),
    matchesPlayed: integer('matches_played').notNull().default(0),
    /** §8.9. */
    jointHitRate: real('joint_hit_rate'),
    /** Realized − expected; null until ≥ SYNERGY_MIN_PICKS graded slots. */
    synergy: real('synergy'),
    /**
     * server-only: §8.10 ladder addition (WS6-T3, additive migration — not in the design doc's
     * §5.5 literal column list, mirrors `profiles.matchmaking_priority`'s §8.4 leftover-priority
     * precedent). Set true for the duo left sitting out an odd-sized tier at `duo:window-roll`;
     * cleared for every duo considered that same run (matched or not). Consumed by
     * `matchDuoVsDuo`'s odd-one-out selection so a duo that already sat out isn't the one to sit
     * out again when an alternative exists. Never client-writable.
     */
    matchmakingPriority: boolean('matchmaking_priority').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** A profile may have at most one active duo (§5.5 partial unique). */
    uniqueIndex('duos_profile_a_active_uq').on(t.profileAId).where(sql`${t.status} = 'active'`),
    uniqueIndex('duos_profile_b_active_uq').on(t.profileBId).where(sql`${t.status} = 'active'`),
  ],
);

/** `duo_queue_entries` (§5.5). */
export const duoQueueEntries = pgTable(
  'duo_queue_entries',
  {
    id: uuid('id').primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    status: queueStatusEnum('status').notNull().default('waiting'),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
    matchedDuoId: uuid('matched_duo_id').references(() => duos.id),
  },
  (t) => [
    uniqueIndex('duo_queue_waiting_uq').on(t.profileId).where(sql`${t.status} = 'waiting'`),
  ],
);

/** `duo_matches` (§5.5). Bonus questions in duo_match_questions; dailies derived by window. */
export const duoMatches = pgTable(
  'duo_matches',
  {
    id: uuid('id').primaryKey(),
    duoAId: uuid('duo_a_id')
      .notNull()
      .references(() => duos.id),
    duoBId: uuid('duo_b_id')
      .notNull()
      .references(() => duos.id),
    windowStart: date('window_start').notNull(),
    windowEnd: date('window_end').notNull(),
    status: duoMatchStatusEnum('status').notNull(),
    scoreA: smallint('score_a').notNull().default(0),
    scoreB: smallint('score_b').notNull().default(0),
    winnerDuoId: uuid('winner_duo_id').references(() => duos.id),
    /** Same idempotency guard as pairings (§8.3). */
    ratingAppliedAt: timestamp('rating_applied_at', { withTimezone: true }),
    /** Both duos' pre-application ratings, written at rating application (§6.5 deep regrade). */
    ratingSnapshot: jsonb('rating_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('duo_matches_status_window_idx').on(t.status, t.windowStart)],
);

/** `duo_match_questions` — bonus questions only (§5.5). */
export const duoMatchQuestions = pgTable(
  'duo_match_questions',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => duoMatches.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.questionId] })],
);

/**
 * `placement_items` — curated historical questions, static content (§5.5).
 * Production content (≥15 rows) is WS4-T8's; WS0-T3 seeds only dev-marked fixtures.
 */
export const placementItems = pgTable('placement_items', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  category: marketCategoryEnum('category').notNull(),
  yesLabel: text('yes_label').notNull(),
  noLabel: text('no_label').notNull(),
  historicalYesPrice: numeric('historical_yes_price', {
    precision: 6,
    scale: 5,
    mode: 'number',
  }).notNull(),
  historicalCrowdYesPct: real('historical_crowd_yes_pct').notNull(),
  outcome: marketSideEnum('outcome').notNull(),
  resolvedOn: date('resolved_on').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** `placement_answers` (§5.5). */
export const placementAnswers = pgTable(
  'placement_answers',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    placementItemId: uuid('placement_item_id')
      .notNull()
      .references(() => placementItems.id),
    side: marketSideEnum('side').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.placementItemId] })],
);
