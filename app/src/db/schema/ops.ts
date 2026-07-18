import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  bigserial,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// §4.9 admin_audit
export const adminAudit = pgTable("admin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  subject: jsonb("subject").notNull().default({}),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// §4.9 events — product metrics. principal_id has no FK (analytics
// survive user deletion).
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    principalId: text("principal_id"),
    anonId: text("anon_id"),
    props: jsonb("props").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_name_at_idx").on(t.name, t.at)]
);

// MVP-only table (§16.3): fixed-window rate-limit counters, replaces Redis.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })]
);
