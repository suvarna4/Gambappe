/**
 * Markets & questions tables (design doc §5.3): markets, market_price_snapshots, questions,
 * picks.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  marketCategoryEnum,
  marketSideEnum,
  marketStatusEnum,
  pickResultEnum,
  pickSourceEnum,
  questionKindEnum,
  questionStatusEnum,
  venueEnum,
} from './enums.js';
import { profiles, users } from './identity.js';

/** `markets` — cached venue markets (§5.3). */
export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey(),
    venue: venueEnum('venue').notNull(),
    venueMarketId: text('venue_market_id').notNull(),
    title: text('title').notNull(),
    category: marketCategoryEnum('category').notNull(),
    closeTime: timestamp('close_time', { withTimezone: true }).notNull(),
    expectedResolveTime: timestamp('expected_resolve_time', { withTimezone: true }),
    status: marketStatusEnum('status').notNull(),
    /** Set when resolved; voids use status='voided'. */
    outcome: marketSideEnum('outcome'),
    yesPrice: numeric('yes_price', { precision: 6, scale: 5, mode: 'number' }),
    yesPriceUpdatedAt: timestamp('yes_price_updated_at', { withTimezone: true }),
    /** Curation filters only — never displayed (INV-8). */
    liquidityUsd: numeric('liquidity_usd', { mode: 'number' }),
    /** Outbound deep link (§7.8). */
    venueUrl: text('venue_url').notNull(),
    /** Curation tag: usable as nemesis/duo bonus market (§8.8.1). */
    nemesisEligible: boolean('nemesis_eligible').notNull().default(false),
    /** TRIMMED venue payload — never the full response (ToS posture, R2). */
    raw: jsonb('raw').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('markets_venue_market_uq').on(t.venue, t.venueMarketId),
    index('markets_status_close_time_idx').on(t.status, t.closeTime),
  ],
);

/** `market_price_snapshots` (§5.3). Retention: 90 days (`maintenance:prune`). */
export const marketPriceSnapshots = pgTable(
  'market_price_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    yesPrice: numeric('yes_price', { precision: 6, scale: 5, mode: 'number' }).notNull(),
  },
  (t) => [index('market_price_snapshots_market_ts_idx').on(t.marketId, t.ts.desc())],
);

/** `questions` — a market served in-app; the scoring boundary (INV-5, §5.3). */
export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey(),
    kind: questionKindEnum('kind').notNull(),
    /** Placement never creates question rows (§5.5). */
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id),
    /** Required when kind='daily'; partial-unique below. */
    questionDate: date('question_date'),
    /** URL identity, e.g. `2026-07-19-world-cup-final`. */
    slug: text('slug'),
    headline: text('headline').notNull(),
    blurb: text('blurb'),
    yesLabel: text('yes_label').notNull(),
    noLabel: text('no_label').notNull(),
    openAt: timestamp('open_at', { withTimezone: true }).notNull(),
    lockAt: timestamp('lock_at', { withTimezone: true }).notNull(),
    /** Target; actual reveal may slip (§6.7). */
    revealAt: timestamp('reveal_at', { withTimezone: true }).notNull(),
    status: questionStatusEnum('status').notNull().default('draft'),
    /** Live counters, tx-maintained (§6.2 step 5). */
    yesCount: integer('yes_count').notNull().default(0),
    noCount: integer('no_count').notNull().default(0),
    /** Snapshot at lock; contrarian metric + reveal display read THESE (§6.2 lock job). */
    crowdYesAtLock: integer('crowd_yes_at_lock'),
    crowdNoAtLock: integer('crowd_no_at_lock'),
    yesPriceAtLock: numeric('yes_price_at_lock', { precision: 6, scale: 5, mode: 'number' }),
    /** Copied from market at grading (§6.5). */
    outcome: marketSideEnum('outcome'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    /** Curation flag: strict stamping rules (§6.2 step 4). */
    isVolatile: boolean('is_volatile').notNull().default(false),
    /** Curation enforces lock_at ≤ event_start_at (§15.2). */
    eventStartAt: timestamp('event_start_at', { withTimezone: true }),
    /** Divergence flavor (§7.7, flag `divergence_display`). */
    pairedMarketId: uuid('paired_market_id').references(() => markets.id),
    /** Admin curator. */
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('questions_slug_uq').on(t.slug),
    // ≤1 ACTIVE daily per date; voided rows are excluded (WS15-T2) so an admin void frees the
    // date slot for a replacement compose. Multiple voided rows per date are legal history.
    uniqueIndex('questions_daily_date_uq')
      .on(t.questionDate)
      .where(sql`${t.kind} = 'daily' AND ${t.status} <> 'voided'`),
    index('questions_kind_status_idx').on(t.kind, t.status),
    index('questions_status_lock_at_idx').on(t.status, t.lockAt),
    index('questions_status_reveal_at_idx').on(t.status, t.revealAt),
  ],
);

/** `picks` — the atomic unit of the product (§5.3). */
export const picks = pgTable(
  'picks',
  {
    id: uuid('id').primaryKey(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    side: marketSideEnum('side').notNull(),
    /** Implied prob of chosen side = side='yes' ? p : 1−p. */
    yesPriceAtEntry: numeric('yes_price_at_entry', {
      precision: 6,
      scale: 5,
      mode: 'number',
    }).notNull(),
    /** When the stamped price was fetched from venue (staleness display). */
    priceStampedAt: timestamp('price_stamped_at', { withTimezone: true }).notNull(),
    /** Server clock. */
    pickedAt: timestamp('picked_at', { withTimezone: true }).notNull().defaultNow(),
    source: pickSourceEnum('source').notNull().default('web'),
    /** Only when flag `confidence_slider`. */
    confidence: smallint('confidence'),
    result: pickResultEnum('result').notNull().default('pending'),
    /** Set at grading: (win?1:0) − p_side_entry (§8.1). */
    edge: numeric('edge', { precision: 7, scale: 5, mode: 'number' }),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    /** False after account deletion (§11.4). */
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('picks_question_profile_uq').on(t.questionId, t.profileId),
    index('picks_profile_picked_at_idx').on(t.profileId, t.pickedAt.desc()),
    index('picks_question_result_idx').on(t.questionId, t.result),
    check('picks_confidence_range', sql`${t.confidence} IS NULL OR (${t.confidence} BETWEEN 50 AND 100)`),
  ],
);
