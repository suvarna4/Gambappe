import {
  pgTable,
  uuid,
  integer,
  numeric,
  boolean,
  date,
  pgEnum,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { questions } from "./questions";

export const nemesisStatusEnum = pgEnum("nemesis_status", [
  "active",
  "completed",
  "cancelled",
]);
export const nemesisWinnerEnum = pgEnum("nemesis_winner", ["a", "b", "tie"]);

// §4.6 nemesis_pairings (MVP: no seasons table — a single implicit season)
export const nemesisPairings = pgTable(
  "nemesis_pairings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekStart: date("week_start").notNull(),
    userA: uuid("user_a")
      .notNull()
      .references(() => users.id),
    userB: uuid("user_b")
      .notNull()
      .references(() => users.id),
    status: nemesisStatusEnum("status").notNull().default("active"),
    scoreA: integer("score_a").notNull().default(0),
    scoreB: integer("score_b").notNull().default(0),
    edgeA: numeric("edge_a", { precision: 10, scale: 6 }).notNull().default("0"),
    edgeB: numeric("edge_b", { precision: 10, scale: 6 }).notNull().default("0"),
    winner: nemesisWinnerEnum("winner"),
    isRematch: boolean("is_rematch").notNull().default(false),
  },
  (t) => [index("nemesis_pairings_week_users_idx").on(t.weekStart, t.userA, t.userB)]
);

// §4.6 nemesis_members — hard one-pairing-per-user-per-week guarantee
export const nemesisMembers = pgTable(
  "nemesis_members",
  {
    weekStart: date("week_start").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    pairingId: uuid("pairing_id")
      .notNull()
      .references(() => nemesisPairings.id),
  },
  (t) => [primaryKey({ columns: [t.weekStart, t.userId] })]
);

// §4.6 nemesis_bonus_questions — reserved, unused at MVP (§16.5)
export const nemesisMatchQuestions = pgTable(
  "nemesis_match_questions",
  {
    pairingId: uuid("pairing_id")
      .notNull()
      .references(() => nemesisPairings.id),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
  },
  (t) => [primaryKey({ columns: [t.pairingId, t.questionId] })]
);
