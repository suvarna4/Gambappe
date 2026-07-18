import {
  pgTable,
  uuid,
  timestamp,
  numeric,
  integer,
  jsonb,
  date,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { questions } from "./questions";
import { users } from "./users";

export const pickSideEnum = pgEnum("pick_side", ["yes", "no"]);
export const pickResultEnum = pgEnum("pick_result", [
  "pending",
  "win",
  "loss",
  "void",
]);

// §4.3 picks — the atomic unit (INV-3)
export const picks = pgTable(
  "picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    side: pickSideEnum("side").notNull(),
    entryPrice: numeric("entry_price", { precision: 6, scale: 5 }).notNull(),
    entryPriceAt: timestamp("entry_price_at", { withTimezone: true }).notNull(),
    pickedAt: timestamp("picked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    result: pickResultEnum("result").notNull().default("pending"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("picks_question_user_unique").on(t.questionId, t.userId),
    index("picks_user_picked_idx").on(t.userId, t.pickedAt),
    index("picks_question_idx").on(t.questionId),
  ]
);

// §4.4 user_stats — one row per user, RECOMPUTED from pick history by
// gradeQuestion / reveal-fanout / claim-merge. Never blind-incremented.
export const userStats = pgTable("user_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  participationStreak: integer("participation_streak").notNull().default(0),
  bestParticipationStreak: integer("best_participation_streak").notNull().default(0),
  winStreak: integer("win_streak").notNull().default(0),
  bestWinStreak: integer("best_win_streak").notNull().default(0),
  lastDailyPickDate: date("last_daily_pick_date"),
  picksTotal: integer("picks_total").notNull().default(0),
  picksResolved: integer("picks_resolved").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  edgeSum: numeric("edge_sum", { precision: 12, scale: 6 }).notNull().default("0"),
  categoryStats: jsonb("category_stats").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
