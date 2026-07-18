/**
 * Reports, blocks, and the pairing mid-week exit rule (design doc §14.3, §5.7, WS11-T3),
 * plus the admin moderation queues (§15.4, WS10-T4): reports queue, bot-flag review list,
 * and auto-pause review list read/resolve on top of the same tables.
 *
 * Scope note: the mid-week exit rule is implemented here for NEMESIS PAIRINGS only (the
 * literal WBS AC: "block cancels active pairing"). §5.7 says duo matches "follow the same
 * early-conclusion rule," but WS6 (duo) has no queue/matcher built yet in this wave — there's
 * nothing to exit in practice — so duo handling is left as a SPEC-GAP for whichever task
 * wires up WS6, mirroring how WS2-T5's account-deletion deferred this exact rule for the same
 * reason before WS5's schema was exercised.
 */
import { and, asc, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../client.js';
import {
  blocks,
  nemesisPairings,
  notifications,
  pairingQuestions,
  picks,
  posts,
  profiles,
  questions,
  ratings,
  reports,
  users,
} from '../schema/index.js';

export type ReportRow = typeof reports.$inferSelect;
export type NewReportRow = typeof reports.$inferInsert;
export type BlockRow = typeof blocks.$inferSelect;
type ProfileRow = typeof profiles.$inferSelect;

export async function insertReport(db: Db, row: NewReportRow): Promise<ReportRow> {
  const [inserted] = await db.insert(reports).values(row).returning();
  if (!inserted) throw new Error('insertReport: no row returned');
  return inserted;
}

/**
 * §14.3: a qualified reporter is a claimed profile, account age ≥ REPORTER_MIN_ACCOUNT_AGE_D,
 * bot_score < BOT_EXCLUDE_THRESHOLD. Counts DISTINCT qualified reporters who reported
 * `reportedProfileId` (any context) with `created_at >= sinceDate` — ghost reports never
 * qualify (report-bombing guard), matching regardless of `reports.status` since even a report
 * later dismissed still counted toward the original auto-pause decision.
 */
export async function countQualifiedReportersSince(
  db: Db,
  reportedProfileId: string,
  sinceDate: Date,
  minAccountAgeDate: Date,
  botExcludeThreshold: number,
): Promise<number> {
  const rows = await db
    .selectDistinct({ reporterProfileId: reports.reporterProfileId })
    .from(reports)
    .innerJoin(profiles, eq(profiles.id, reports.reporterProfileId))
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(
        eq(reports.reportedProfileId, reportedProfileId),
        gte(reports.createdAt, sinceDate),
        eq(profiles.kind, 'claimed'),
        lte(users.createdAt, minAccountAgeDate),
        lt(profiles.botScore, botExcludeThreshold),
      ),
    );
  return rows.length;
}

export async function insertBlock(db: Db, blockerProfileId: string, blockedProfileId: string): Promise<BlockRow> {
  const [inserted] = await db
    .insert(blocks)
    .values({ blockerProfileId, blockedProfileId })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  // Already blocked — idempotent re-block returns the existing row rather than erroring.
  const [existing] = await db
    .select()
    .from(blocks)
    .where(and(eq(blocks.blockerProfileId, blockerProfileId), eq(blocks.blockedProfileId, blockedProfileId)));
  if (!existing) throw new Error('insertBlock: row missing after conflict');
  return existing;
}

export async function deleteBlock(db: Db, blockerProfileId: string, blockedProfileId: string): Promise<boolean> {
  const deleted = await db
    .delete(blocks)
    .where(and(eq(blocks.blockerProfileId, blockerProfileId), eq(blocks.blockedProfileId, blockedProfileId)))
    .returning();
  return deleted.length > 0;
}

export type NemesisPairingRow = typeof nemesisPairings.$inferSelect;

/** The blocked profile's currently-active pairing, if any (§5.7 exit applies to `active` only). */
export async function findActivePairingInvolving(db: Db, profileId: string): Promise<NemesisPairingRow | null> {
  const [row] = await db
    .select()
    .from(nemesisPairings)
    .where(
      and(
        eq(nemesisPairings.status, 'active'),
        or(eq(nemesisPairings.profileAId, profileId), eq(nemesisPairings.profileBId, profileId)),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface SharedQuestionPicks {
  questionId: string;
  isVoid: boolean;
  isSettled: boolean;
  profileAPick: { picked: boolean; won: boolean; edge: number };
  profileBPick: { picked: boolean; won: boolean; edge: number };
}

/** Every bonus question shared by the pairing, with both sides' pick outcome (§8.8 input shape). */
export async function getPairingSharedQuestionPicks(
  db: Db,
  pairingId: string,
  profileAId: string,
  profileBId: string,
): Promise<SharedQuestionPicks[]> {
  const rows = await db
    .select({
      questionId: questions.id,
      status: questions.status,
      pickProfileId: picks.profileId,
      pickResult: picks.result,
      pickEdge: picks.edge,
    })
    .from(pairingQuestions)
    .innerJoin(questions, eq(questions.id, pairingQuestions.questionId))
    .leftJoin(
      picks,
      and(
        eq(picks.questionId, pairingQuestions.questionId),
        or(eq(picks.profileId, profileAId), eq(picks.profileId, profileBId)),
      ),
    )
    .where(eq(pairingQuestions.pairingId, pairingId));

  const byQuestion = new Map<string, SharedQuestionPicks>();
  for (const row of rows) {
    const existing = byQuestion.get(row.questionId) ?? {
      questionId: row.questionId,
      isVoid: row.status === 'voided',
      isSettled: row.status === 'revealed' || row.status === 'voided',
      profileAPick: { picked: false, won: false, edge: 0 },
      profileBPick: { picked: false, won: false, edge: 0 },
    };
    if (row.pickProfileId === profileAId) {
      existing.profileAPick = { picked: true, won: row.pickResult === 'win', edge: Number(row.pickEdge ?? 0) };
    } else if (row.pickProfileId === profileBId) {
      existing.profileBPick = { picked: true, won: row.pickResult === 'win', edge: Number(row.pickEdge ?? 0) };
    }
    byQuestion.set(row.questionId, existing);
  }
  return [...byQuestion.values()];
}

export type RatingRow = typeof ratings.$inferSelect;

export async function getOrDefaultRating(db: Db, profileId: string): Promise<RatingRow> {
  const [row] = await db.select().from(ratings).where(eq(ratings.profileId, profileId));
  if (row) return row;
  const [inserted] = await db.insert(ratings).values({ profileId }).returning();
  if (!inserted) throw new Error('getOrDefaultRating: insert failed');
  return inserted;
}

export interface ConcludePairingInput {
  status: 'cancelled' | 'completed';
  scoreA?: number;
  scoreB?: number;
  edgeA?: number;
  edgeB?: number;
  winnerProfileId?: string | null;
  verdict?: Record<string, unknown>;
  ratingAppliedAt?: Date;
}

export async function updatePairingConclusion(
  db: Db,
  pairingId: string,
  input: ConcludePairingInput,
  at: Date,
): Promise<void> {
  await db
    .update(nemesisPairings)
    .set({
      status: input.status,
      ...(input.scoreA !== undefined ? { scoreA: input.scoreA } : {}),
      ...(input.scoreB !== undefined ? { scoreB: input.scoreB } : {}),
      ...(input.edgeA !== undefined ? { edgeA: input.edgeA } : {}),
      ...(input.edgeB !== undefined ? { edgeB: input.edgeB } : {}),
      ...(input.winnerProfileId !== undefined ? { winnerProfileId: input.winnerProfileId } : {}),
      ...(input.verdict !== undefined ? { verdict: input.verdict } : {}),
      ...(input.ratingAppliedAt !== undefined ? { ratingAppliedAt: input.ratingAppliedAt } : {}),
      updatedAt: at,
    })
    .where(eq(nemesisPairings.id, pairingId));
}

export async function updateRating(
  db: Db,
  profileId: string,
  rating: { rating: number; rd: number; vol: number },
  at: Date,
): Promise<void> {
  await db
    .update(ratings)
    .set({ glickoRating: rating.rating, glickoRd: rating.rd, glickoVol: rating.vol, updatedAt: at })
    .where(eq(ratings.profileId, profileId));
}

export async function incrementGamesCount(db: Db, profileId: string, at: Date): Promise<void> {
  await db
    .update(ratings)
    .set({ gamesCount: sql`${ratings.gamesCount} + 1`, updatedAt: at })
    .where(eq(ratings.profileId, profileId));
}

/** §14.3's neutral notification — "Your match this week ended early." — queued for both sides. */
export async function insertNeutralExitNotification(db: Db, profileId: string, at: Date): Promise<void> {
  await db.insert(notifications).values({
    id: uuidv7(),
    profileId,
    kind: 'pairing_ended_early',
    payload: {},
    channel: 'email',
    scheduledAt: at,
  });
}

/** Oldest-first — the 48h-review SLA (§15.4 runbook note) starts from `created_at`. */
export async function listOpenReports(db: Db): Promise<ReportRow[]> {
  return db.select().from(reports).where(eq(reports.status, 'open')).orderBy(asc(reports.createdAt));
}

export async function getReportById(db: Db, id: string): Promise<ReportRow | null> {
  const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  return row ?? null;
}

export interface ResolveReportInput {
  status: 'actioned' | 'dismissed';
  resolvedByUserId: string | null;
  resolvedAt: Date;
}

export async function resolveReport(db: Db, id: string, input: ResolveReportInput): Promise<ReportRow | null> {
  const [row] = await db
    .update(reports)
    .set({ status: input.status, resolvedByUserId: input.resolvedByUserId, resolvedAt: input.resolvedAt })
    .where(eq(reports.id, id))
    .returning();
  return row ?? null;
}

export async function updatePostStatus(
  db: Db,
  postId: string,
  status: 'removed_by_mod',
): Promise<void> {
  await db.update(posts).set({ status, updatedAt: new Date() }).where(eq(posts.id, postId));
}

export async function updateProfileStatus(
  db: Db,
  profileId: string,
  status: 'active' | 'paused_matchmaking' | 'suspended',
): Promise<ProfileRow | null> {
  const [row] = await db
    .update(profiles)
    .set({ status, updatedAt: new Date() })
    .where(eq(profiles.id, profileId))
    .returning();
  return row ?? null;
}

/** Bot-flag review list (§14.2): surfaced for review, never auto-actioned here. */
export async function listBotFlaggedProfiles(db: Db, threshold: number): Promise<ProfileRow[]> {
  return db
    .select()
    .from(profiles)
    .where(gte(profiles.botScore, threshold))
    .orderBy(desc(profiles.botScore));
}

/** Auto-pause review list (§14.3): "reviewed within 48h" — oldest-paused first. */
export async function listAutoPausedProfiles(db: Db): Promise<ProfileRow[]> {
  return db
    .select()
    .from(profiles)
    .where(eq(profiles.status, 'paused_matchmaking'))
    .orderBy(asc(profiles.updatedAt));
}
