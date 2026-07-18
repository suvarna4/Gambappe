/**
 * Engine tables (design doc §5.4): fingerprints, ratings, seasons.
 */
import { date, integer, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { seasonKindEnum } from './enums.js';
import { profiles } from './identity.js';

/** `fingerprints` — rebuilt nightly, one row per profile (§8.1). */
export const fingerprints = pgTable('fingerprints', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  /** n used for shrinkage. */
  resolvedPickCount: integer('resolved_pick_count').notNull().default(0),
  /** §8.1; null if n=0. */
  brier: real('brier'),
  accuracy: real('accuracy'),
  edgeMean: real('edge_mean'),
  /** [−1,1] normalized, shrunk. */
  chalk: real('chalk'),
  contrarian: real('contrarian'),
  timing: real('timing'),
  /** `{sports:0.4,...}` sums to 1 over picked categories. */
  categoryShares: jsonb('category_shares'),
  /** Per-category accuracy where n≥5, else omitted. */
  categoryAccuracy: jsonb('category_accuracy'),
  /** Null until `confidence_slider` ships. */
  calibration: jsonb('calibration'),
  /** Seeded axes from placement/wallet import; blended per §8.7. */
  placementPrior: jsonb('placement_prior'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
});

/** `ratings` (§5.4). Defaults 1500/350/0.06 (§8.3). */
export const ratings = pgTable('ratings', {
  profileId: uuid('profile_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  glickoRating: real('glicko_rating').notNull().default(1500),
  glickoRd: real('glicko_rd').notNull().default(350),
  glickoVol: real('glicko_vol').notNull().default(0.06),
  /** Rated games (nemesis weeks). */
  gamesCount: integer('games_count').notNull().default(0),
  /** Display-only, nightly, among profiles with ≥10 resolved picks. */
  accuracyPercentile: real('accuracy_percentile'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** `seasons` (§5.4). Nemesis seasons = NEMESIS_SEASON_WEEKS. Seeded by admin. */
export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey(),
  kind: seasonKindEnum('kind').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
