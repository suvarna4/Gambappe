import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  date,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { markets } from "./markets";
import { users } from "./users";

export const questionKindEnum = pgEnum("question_kind", [
  "daily",
  "nemesis_bonus",
  "duo",
  "placement",
]);
export const questionStatusEnum = pgEnum("question_status", [
  "draft",
  "open",
  "locked",
  "graded",
  "revealed",
  "voided",
]);

// §4.2 questions
export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    kind: questionKindEnum("kind").notNull(),
    questionDate: date("question_date"),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    locksAt: timestamp("locks_at", { withTimezone: true }).notNull(),
    status: questionStatusEnum("status").notNull().default("draft"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    revealAt: timestamp("reveal_at", { withTimezone: true }),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    crowdYes: integer("crowd_yes").notNull().default(0),
    crowdNo: integer("crowd_no").notNull().default(0),
    crowdYesAtLock: integer("crowd_yes_at_lock"),
    crowdNoAtLock: integer("crowd_no_at_lock"),
    priceYesAtLock: numeric("price_yes_at_lock", { precision: 6, scale: 5 }),
    priceYesAtSettle: numeric("price_yes_at_settle", { precision: 6, scale: 5 }),
    headline: text("headline").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("questions_daily_date_unique")
      .on(t.questionDate)
      .where(sql`${t.kind} = 'daily'`),
    index("questions_status_locks_idx").on(t.status, t.locksAt),
    index("questions_kind_idx").on(t.kind),
  ]
);

// §4.2 question_participants — rows only for kind IN ('nemesis_bonus','duo')
export const questionParticipants = pgTable(
  "question_participants",
  {
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.userId] })]
);
