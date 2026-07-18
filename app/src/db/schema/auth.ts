import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * MVP auth note: the full design (§3.1) specifies Auth.js v5 with DB
 * sessions. Auth.js's official Drizzle adapter assumes its own
 * name/email/emailVerified/image user shape and mints its own ids on
 * sign-in, which conflicts with D-1 (ghost row promotion must keep the
 * SAME users.id — claiming is a promotion, never a migration). Rather
 * than fight the adapter, the MVP hand-rolls Google's OAuth2 code flow
 * (see src/server/google-oauth.ts) and a plain DB-session table below —
 * same DB-session, revocable behavior the design calls for, applied
 * directly to our one `users` row per identity.
 */
export const sessions = pgTable(
  "sessions",
  {
    // sha256(token) hex — the httpOnly cookie carries the raw token only.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

// OAuth state nonce, short-lived, CSRF protection for the Google flow.
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  ghostUserId: uuid("ghost_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
