/**
 * Social, integrity, linking, comms, analytics tables (design doc §5.6) + audit_log.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  calloutStatusEnum,
  marketCategoryEnum,
  notificationChannelEnum,
  notificationStatusEnum,
  postStatusEnum,
  reportContextEnum,
  reportReasonEnum,
  reportStatusEnum,
  threadContextEnum,
  walletLinkStatusEnum,
} from './enums.js';
import { profiles, users } from './identity.js';
import { nemesisPairings } from './modes.js';

/** `posts` (§5.6). Claimed profiles only (enforced in API). Body ≤ POST_MAX_CHARS. */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey(),
    contextKind: threadContextEnum('context_kind').notNull(),
    contextId: uuid('context_id').notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    body: text('body').notNull(),
    status: postStatusEnum('status').notNull().default('visible'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('posts_context_created_idx').on(t.contextKind, t.contextId, t.createdAt)],
);

/** `reactions` (§5.6). Emoji must be in REACTION_SET (API-enforced). Ghosts allowed. */
export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey(),
    contextKind: threadContextEnum('context_kind').notNull(),
    contextId: uuid('context_id').notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reactions_context_profile_emoji_uq').on(
      t.contextKind,
      t.contextId,
      t.profileId,
      t.emoji,
    ),
  ],
);

/** `blocks` (§5.6): permanent matchmaking exclusion both directions. Composite PK, no id. */
export const blocks = pgTable(
  'blocks',
  {
    blockerProfileId: uuid('blocker_profile_id')
      .notNull()
      .references(() => profiles.id),
    blockedProfileId: uuid('blocked_profile_id')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerProfileId, t.blockedProfileId] })],
);

/** `reports` (§5.6, §14.3). */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterProfileId: uuid('reporter_profile_id')
      .notNull()
      .references(() => profiles.id),
    reportedProfileId: uuid('reported_profile_id').references(() => profiles.id),
    contextKind: reportContextEnum('context_kind').notNull(),
    contextId: uuid('context_id').notNull(),
    reason: reportReasonEnum('reason').notNull(),
    note: text('note'),
    status: reportStatusEnum('status').notNull().default('open'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reports_status_idx').on(t.status, t.createdAt)],
);

/** `wallet_links` (§5.6, §12). No credential/key columns exist anywhere (INV-2). */
export const walletLinks = pgTable(
  'wallet_links',
  {
    id: uuid('id').primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    /** Lowercased EOA; NULLED on unlink/deletion (§12.5). */
    address: text('address'),
    /** HMAC-SHA256(address, WALLET_HASH_SECRET); survives unlink solely for relink cooldown. */
    addressHash: text('address_hash').notNull(),
    /** Resolved Polymarket proxy (§12.3); nulled on unlink. */
    proxyAddress: text('proxy_address'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    status: walletLinkStatusEnum('status').notNull(),
    /** Bucketed stats only (§12.4); DELETED (set null) on unlink. */
    enrichment: jsonb('enrichment'),
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One active link per profile (§5.6). */
    uniqueIndex('wallet_links_profile_active_uq')
      .on(t.profileId)
      .where(sql`${t.status} = 'active'`),
    /** An address links to one profile at a time (§5.6). */
    uniqueIndex('wallet_links_address_hash_active_uq')
      .on(t.addressHash)
      .where(sql`${t.status} = 'active'`),
  ],
);

/** `notifications` — outbox pattern (§5.6, §13.2). */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    /** Beat catalog key (§13.3). */
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    channel: notificationChannelEnum('channel').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    status: notificationStatusEnum('status').notNull().default('queued'),
    /** e.g. `reveal:2026-07-19:profileId`. */
    dedupeKey: text('dedupe_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_status_scheduled_idx').on(t.status, t.scheduledAt)],
);

/** `push_subscriptions` (§5.6). */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey(),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => profiles.id),
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/**
 * `analytics_events` (§5.6, §13.1). MONTHLY PARTITIONS from day one: the generated DDL in
 * `0001_init` is hand-adjusted to `PARTITION BY RANGE (ts)` (see drizzle/0001_init.sql), and
 * `maintenance:prune` creates upcoming partitions + drops expired ones. The PK includes `ts`
 * because a partitioned PK must contain the partition key. No raw IP/UA is EVER stored —
 * `ip_hash`/`ua_hash` use a per-day Redis-only salt and are nulled after 7 days (§5.6).
 */
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: bigserial('id', { mode: 'number' }).notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    event: text('event').notNull(),
    profileId: uuid('profile_id'),
    isGhost: boolean('is_ghost'),
    /** Pre-ghost spectators; client UUID, strict format or dropped. */
    anonId: text('anon_id'),
    /** ≤ EVENT_PROPS_MAX_BYTES; oversized events dropped at ingestion. */
    props: jsonb('props').notNull().default({}),
    ipHash: text('ip_hash'),
    uaHash: text('ua_hash'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.ts] }),
    index('analytics_events_event_ts_idx').on(t.event, t.ts),
    index('analytics_events_profile_ts_idx').on(t.profileId, t.ts),
  ],
);

/**
 * `topic_follows` (journeys plan §4/§5 WS16-T2): a `(profile, market category)` follow driving
 * the stack feed's topic selection. Ghosts allowed (resolved via the ghost cookie, WS18-T2).
 * Composite PK, no surrogate id — a follow is fully identified by profile + category.
 */
export const topicFollows = pgTable(
  'topic_follows',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    category: marketCategoryEnum('category').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.category] })],
);

/**
 * `callouts` (journeys plan §4/§5 WS20-T3, D-J5): a signed challenge link. The challenger mints
 * one; whoever accepts (claimed-only) becomes `opponent` and a next-week nemesis pairing is
 * created (`pairingId`). Only the SHA-256 of the token is stored (`tokenHash`) — the raw token
 * lives solely in the shared URL, never at rest.
 */
export const callouts = pgTable(
  'callouts',
  {
    id: uuid('id').primaryKey(),
    challengerProfileId: uuid('challenger_profile_id')
      .notNull()
      .references(() => profiles.id),
    /** Null until accepted (journeys plan §4). */
    opponentProfileId: uuid('opponent_profile_id').references(() => profiles.id),
    /** SHA-256(token) hex — the raw token is never persisted. */
    tokenHash: text('token_hash').notNull(),
    status: calloutStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** The next-week pairing created on accept. */
    pairingId: uuid('pairing_id').references(() => nemesisPairings.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('callouts_token_hash_uq').on(t.tokenHash),
    index('callouts_challenger_idx').on(t.challengerProfileId, t.createdAt),
    index('callouts_opponent_idx').on(t.opponentProfileId),
  ],
);

/** `audit_log` (§5.6, §15.5). Written by every admin mutation. Retention 24 months. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target').notNull(),
    detail: jsonb('detail').notNull().default({}),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_ts_idx').on(t.ts)],
);
