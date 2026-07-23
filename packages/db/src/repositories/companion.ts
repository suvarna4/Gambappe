/**
 * Companion (xTrace + Claude) repository (docs/xtrace-hackathon-tasks.md XH-T4): the
 * generated-artifact cache, xTrace ingestion idempotency, and the shared lifetime-record
 * aggregate T6/T7 both need — one owner so win/draw bucketing can't drift between the two.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { CompanionArtifactKind } from '@receipts/core';
import type { Db } from '../client.js';
import {
  companionArtifacts,
  companionIngestLog,
  nemesisPairings,
  seasons,
  type CompanionArtifactContent,
} from '../schema/index.js';

export type { CompanionArtifactContent };
export type CompanionArtifactRow = typeof companionArtifacts.$inferSelect;

export interface InsertArtifactRow {
  kind: CompanionArtifactKind;
  cacheKey: string;
  profileId: string;
  pairingId?: string | null;
  seasonId?: string | null;
  content: CompanionArtifactContent;
}

/** `'pairing_verdict' | 'post'` — the two xTrace ingestion source kinds (XH-T5). */
export type CompanionIngestSourceKind = 'pairing_verdict' | 'post';

export interface CompanionIngestLogEntry {
  sourceKind: CompanionIngestSourceKind;
  sourceId: string;
}

// --- Cache-key builders (pinned; T6/T7/T8 MUST call these instead of string-formatting keys
// inline — a separator/ordering typo in any one consumer would silently break cache hits, since
// the fail-open design turns a miss into invisible per-request regeneration, not an error). ---

export function banterCacheKey(pairingId: string, profileId: string, etDay: string): string {
  return `banter:${pairingId}:${profileId}:${etDay}`;
}

export function calloutDraftCacheKey(
  challengerProfileId: string,
  targetProfileId: string,
  etDay: string,
): string {
  return `callout_draft:${challengerProfileId}:${targetProfileId}:${etDay}`;
}

export function recapCacheKey(seasonId: string, profileId: string): string {
  return `recap:${seasonId}:${profileId}`;
}

export async function getArtifactByCacheKey(
  db: Db,
  cacheKey: string,
): Promise<CompanionArtifactRow | null> {
  const [row] = await db
    .select()
    .from(companionArtifacts)
    .where(eq(companionArtifacts.cacheKey, cacheKey))
    .limit(1);
  return row ?? null;
}

/**
 * `INSERT ... ON CONFLICT (cache_key) DO NOTHING`, then `SELECT` — safe under concurrent
 * generation of the same key: whichever insert wins, both callers read back the same row.
 */
export async function insertArtifactIdempotent(
  db: Db,
  row: InsertArtifactRow,
): Promise<CompanionArtifactRow> {
  await db
    .insert(companionArtifacts)
    .values({
      id: uuidv7(),
      kind: row.kind,
      cacheKey: row.cacheKey,
      profileId: row.profileId,
      pairingId: row.pairingId ?? null,
      seasonId: row.seasonId ?? null,
      content: row.content,
    })
    .onConflictDoNothing({ target: companionArtifacts.cacheKey });

  const existing = await getArtifactByCacheKey(db, row.cacheKey);
  if (!existing) throw new Error('insertArtifactIdempotent: no row after insert');
  return existing;
}

/**
 * The `kind = 'season_recap'` row for the profile whose SEASON ended most recently — ordered
 * by `seasons.ends_on DESC` (tie-break `createdAt DESC`), NOT by `createdAt` alone: recap keys
 * are per-season, and the XH-T9 runbook's given-seasonId path can (re)generate an OLDER
 * season's recap after a newer one exists, which insertion order would then show as the wrong
 * season on `/you`, silently (the fail-open design masks it). The `kind` filter is load-bearing
 * too — a fresher banter artifact must not shadow the recap.
 */
export async function latestRecapForProfile(
  db: Db,
  profileId: string,
): Promise<CompanionArtifactRow | null> {
  const [row] = await db
    .select({ artifact: companionArtifacts })
    .from(companionArtifacts)
    .innerJoin(seasons, eq(companionArtifacts.seasonId, seasons.id))
    .where(
      and(eq(companionArtifacts.profileId, profileId), eq(companionArtifacts.kind, 'season_recap')),
    )
    .orderBy(desc(seasons.endsOn), desc(companionArtifacts.createdAt))
    .limit(1);
  return row?.artifact ?? null;
}

/**
 * Records sources whose xTrace ingest SUCCEEDED. Callers (XH-T5) select candidates with
 * `filterUningested`, ingest to xTrace, and call this only after every ingest call for the
 * source returned true; the returned list lets a concurrent duplicate run detect ids another
 * run already recorded. Never call this BEFORE ingesting — a marked-but-never-ingested source
 * is silently lost forever (duplicate facts are acceptable, missing facts are not).
 */
export async function markIngested(db: Db, entries: CompanionIngestLogEntry[]): Promise<string[]> {
  if (entries.length === 0) return [];
  const rows = await db
    .insert(companionIngestLog)
    .values(entries.map((e) => ({ sourceKind: e.sourceKind, sourceId: e.sourceId })))
    .onConflictDoNothing({ target: [companionIngestLog.sourceKind, companionIngestLog.sourceId] })
    .returning({ sourceId: companionIngestLog.sourceId });
  return rows.map((r) => r.sourceId);
}

export async function filterUningested(
  db: Db,
  sourceKind: CompanionIngestSourceKind,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const alreadyIngested = await db
    .select({ sourceId: companionIngestLog.sourceId })
    .from(companionIngestLog)
    .where(
      and(eq(companionIngestLog.sourceKind, sourceKind), inArray(companionIngestLog.sourceId, ids)),
    );
  const ingestedIds = new Set(alreadyIngested.map((r) => r.sourceId));
  return ids.filter((id) => !ingestedIds.has(id));
}

function betweenBothOrders(profileId: string, opponentProfileId: string) {
  return and(
    eq(nemesisPairings.status, 'completed'),
    or(
      and(
        eq(nemesisPairings.profileAId, profileId),
        eq(nemesisPairings.profileBId, opponentProfileId),
      ),
      and(
        eq(nemesisPairings.profileAId, opponentProfileId),
        eq(nemesisPairings.profileBId, profileId),
      ),
    ),
  );
}

/**
 * Direct SQL aggregate over `completed` nemesis_pairings between the two profiles, bucketed by
 * `winner_profile_id` (null = draw), oriented to `profileId`. One owner so T6 and T7 cannot
 * drift on win/draw bucketing.
 */
export async function lifetimeRecordBetween(
  db: Db,
  profileId: string,
  opponentProfileId: string,
): Promise<{ wins: number; losses: number; draws: number }> {
  const [row] = await db
    .select({
      wins: sql<number>`count(*) filter (where ${nemesisPairings.winnerProfileId} = ${profileId})::int`,
      losses: sql<number>`count(*) filter (where ${nemesisPairings.winnerProfileId} = ${opponentProfileId})::int`,
      draws: sql<number>`count(*) filter (where ${nemesisPairings.winnerProfileId} is null)::int`,
    })
    .from(nemesisPairings)
    .where(betweenBothOrders(profileId, opponentProfileId));
  return { wins: row?.wins ?? 0, losses: row?.losses ?? 0, draws: row?.draws ?? 0 };
}

/** Ids of the same completed pairings `lifetimeRecordBetween` aggregates — T6/T7 map these
 * through `pairingGroupId` for xTrace memory search scoping. */
export async function completedPairingIdsBetween(
  db: Db,
  profileId: string,
  opponentProfileId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: nemesisPairings.id })
    .from(nemesisPairings)
    .where(betweenBothOrders(profileId, opponentProfileId));
  return rows.map((r) => r.id);
}
