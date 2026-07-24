/**
 * Companion (xTrace + Claude) storage (docs/xtrace-hackathon-tasks.md XH-T4): generated
 * artifacts (the cost-bounding cache, one row per cache key) and xTrace ingestion
 * idempotency (one row per already-ingested source).
 */
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companionArtifactKindEnum } from './enums.js';
import { profiles } from './identity.js';
import { nemesisPairings } from './modes.js';
import { seasons } from './engine.js';

/**
 * `content` shape: one optional slot per artifact kind (`lines` for banter, `drafts` for
 * callout drafts, `recap` for season recaps — T7 has no packages/db ownership of its own, so
 * its storage key is pinned here) plus the generation provenance every kind carries.
 */
export interface CompanionArtifactContent {
  lines?: string[];
  drafts?: string[];
  recap?: { title: string; paragraphs: string[] };
  model: string;
  promptVersion: number;
}

export const companionArtifacts = pgTable(
  'companion_artifacts',
  {
    id: uuid('id').primaryKey(),
    kind: companionArtifactKindEnum('kind').notNull(),
    cacheKey: text('cache_key').notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id),
    pairingId: uuid('pairing_id').references(() => nemesisPairings.id),
    seasonId: uuid('season_id').references(() => seasons.id),
    content: jsonb('content').$type<CompanionArtifactContent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('companion_artifacts_cache_key_uq').on(t.cacheKey),
    index('companion_artifacts_profile_kind_created_idx').on(t.profileId, t.kind, t.createdAt),
  ],
);

/** One row per xTrace source already ingested — the idempotency guard XH-T5's sweep checks. */
export const companionIngestLog = pgTable(
  'companion_ingest_log',
  {
    /** `'pairing_verdict' | 'post'` (app-enforced; not a pg enum — see XH-T4 spec). */
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sourceKind, t.sourceId] })],
);

/**
 * One row per pairing, mapping to the server-issued xTrace group id used to tag its rivalry
 * memory (docs/xtrace-hackathon-tasks.md XH-T10). `group_ids` sent to xTrace must be ids
 * previously returned by `POST /v1/groups` — a pairing has exactly one group, ever, so
 * `pairing_id` is the primary key (no composite key needed, unlike `companion_ingest_log`'s
 * two-source-kind shape).
 */
export const companionXtraceGroups = pgTable('companion_xtrace_groups', {
  pairingId: uuid('pairing_id')
    .primaryKey()
    .references(() => nemesisPairings.id),
  xtraceGroupId: text('xtrace_group_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
