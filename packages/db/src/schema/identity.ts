/**
 * Identity tables (design doc §5.2): profiles, streak_freeze_uses, users + Auth.js tables.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { profileKindEnum, profileStatusEnum, userRoleEnum } from './enums.js';

/**
 * `users` — auth only (§5.2). Auth.js standard tables via the Drizzle adapter, minus columns
 * INV-4 forbids: no name, no phone, no address, no image. Email lives here (never on
 * `profiles`) so public queries can't leak it.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  /** Admins set by seed/ops only (§15.1). */
  role: userRoleEnum('role').notNull().default('user'),
  /** Required non-null before claim completes (INV-9). */
  ageAttestedAt: timestamp('age_attested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Auth.js `accounts` (OAuth provider links). Hard-deleted with the user (§11.4). */
export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: integer('expires_at'),
    tokenType: text('token_type'),
    scope: text('scope'),
    idToken: text('id_token'),
    sessionState: text('session_state'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index('accounts_user_id_idx').on(t.userId),
  ],
);

/** Auth.js database sessions (30-day rolling, §11.1). */
export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** Auth.js magic-link verification tokens (TTL = MAGIC_LINK_TTL_MIN, §11.1). */
export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/** `profiles` — the public identity: ghosts AND claimed users (§5.2, DD-4). */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey(),
    kind: profileKindEnum('kind').notNull(),
    status: profileStatusEnum('status').notNull().default('active'),
    /** e.g. `Fox #4821` (§6.1.2). */
    handle: text('handle').notNull(),
    /** URL-safe form (`fox-4821`); all profile routes/APIs address by slug (§5.2). */
    slug: text('slug').notNull(),
    /** Server-only: §8.4 leftovers; cleared after next assignment. Never client-writable. */
    matchmakingPriority: boolean('matchmaking_priority').notNull().default(false),
    handleIsGenerated: boolean('handle_is_generated').notNull().default(true),
    /**
     * When the handle was last changed (WS2-T4, §6.1.2 cooldown). Null for a never-changed
     * (still-generated) handle. Added by WS2 — no other workstream reads/writes this column.
     */
    handleChangedAt: timestamp('handle_changed_at', { withTimezone: true }),
    userId: uuid('user_id')
      .unique()
      .references(() => users.id, { onDelete: 'set null' }),
    /** HMAC-SHA256(cookie secret, GHOST_COOKIE_SECRET); null after claim (§6.1.1). */
    ghostSecretHash: text('ghost_secret_hash'),
    mergedIntoProfileId: uuid('merged_into_profile_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    /** Touched at most 1/hour per profile. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    /** IANA zone; only for notification quiet hours + nemesis tz preference. */
    timezone: text('timezone'),
    /** 18+ self-attestation; required non-null before any pick exists (INV-9). */
    ageAttestedAt: timestamp('age_attested_at', { withTimezone: true }),
    /** 0–1 (§14.2). */
    botScore: real('bot_score').notNull().default(0),
    /**
     * WS26 (docs/plans/cpu-nemesis-wbs.md): pick policy of a `kind='cpu'` rival — validated
     * against @receipts/core `CPU_PERSONAS`, text (not a pg enum) so the roster can grow
     * without migrations. Null on every human profile; no other workstream writes this.
     */
    cpuPersona: text('cpu_persona'),
    /** Participation streak (DD-3). */
    currentStreak: integer('current_streak').notNull().default(0),
    bestStreak: integer('best_streak').notNull().default(0),
    /** Last question_date counted into streak. */
    lastCountedDate: date('last_counted_date'),
    /** 0..STREAK_FREEZE_CAP. */
    freezeBank: smallint('freeze_bank').notNull().default(0),
    /**
     * The Monday (window_start) of the last week `streak:freeze-grant` granted this profile a
     * freeze — self-exclusion marker so a crash-then-pg-boss-redelivery re-run is a no-op for
     * already-granted profiles (same idempotency pattern as `last_counted_date` for
     * `streak:sweep`), instead of re-granting anyone still below `freeze_bank` cap. Added by
     * WS3-T3 — no other workstream reads/writes this column.
     */
    lastFreezeGrantWeek: date('last_freeze_grant_week'),
    /** Record only, no freezes. */
    currentWinStreak: integer('current_win_streak').notNull().default(0),
    bestWinStreak: integer('best_win_streak').notNull().default(0),
    /** zod-validated ProfileSettings (§9.4). */
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('profiles_handle_lower_uq').on(sql`lower(${t.handle})`),
    uniqueIndex('profiles_slug_uq').on(t.slug),
    index('profiles_kind_status_idx').on(t.kind, t.status),
    index('profiles_bot_score_idx')
      .on(t.botScore)
      .where(sql`${t.botScore} > 0.5`),
  ],
);

/**
 * `streak_freeze_uses` — durable record of freeze consumption (§5.2): required for replay
 * (§6.6). Streak state is NEVER reconstructed from analytics_events.
 */
export const streakFreezeUses = pgTable(
  'streak_freeze_uses',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    /** The missed day the freeze covered. */
    coveredDate: date('covered_date').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.coveredDate] })],
);
