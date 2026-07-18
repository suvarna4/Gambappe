import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userKindEnum = pgEnum("user_kind", ["ghost", "pending", "claimed"]);
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "paused_matchmaking",
  "suspended",
  "deleted",
]);

// §4.1 users
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: userKindEnum("kind").notNull().default("ghost"),
    handle: text("handle").notNull(),
    handleCustomized: boolean("handle_customized").notNull().default(false),
    email: text("email"),
    tz: text("tz"),
    status: userStatusEnum("status").notNull().default("active"),
    ageAttestedAt: timestamp("age_attested_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    botSuspect: boolean("bot_suspect").notNull().default(false),
    settings: jsonb("settings").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_handle_unique").on(t.handle),
    uniqueIndex("users_email_unique")
      .on(t.email)
      .where(sql`${t.email} is not null`),
    index("users_kind_idx").on(t.kind),
    index("users_status_idx").on(t.status),
    index("users_bot_suspect_idx")
      .on(t.botSuspect)
      .where(sql`${t.botSuspect} = true`),
  ]
);

// §4.1 ghost_devices — integrity signal only
export const ghostDevices = pgTable(
  "ghost_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    uaHash: text("ua_hash").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ghost_devices_ip_hash_idx").on(t.ipHash)]
);
