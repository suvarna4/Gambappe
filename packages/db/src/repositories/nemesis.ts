/**
 * Nemesis assignment + pairing lifecycle repository (design doc §5.5, §8.4, §8.8, WS5-T1). This
 * is the first WS5 task, so this file is new — thin DB primitives only; the actual matchmaking
 * algorithm (`matchNemeses`, WS4-T4) and week scoring (`scoreNemesisWeek`, WS4-T6) are pure
 * functions in `@receipts/engine` that the caller (apps/worker's `nemesis:assign` job, and
 * `apps/worker/src/lib/pairing-lifecycle.ts`) invokes with the data these helpers load.
 *
 * `listActiveNemesisPairings` below is WS9-T3's earlier, minimal mock-start placeholder for this
 * same file (§7.6 `nemesis:lastday` needed *some* real-pairing read before WS5 landed) — kept
 * verbatim rather than replaced, since `apps/worker/src/jobs/nemesis-lastday.ts` already depends
 * on its exact shape via the `@receipts/db` barrel.
 */
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { addDaysToDateString, NEMESIS_SEASON_WEEKS, type MarketCategory } from '@receipts/core';
import { uuidv7 } from 'uuidv7';
import type { Db } from '../client.js';
import {
  blocks,
  markets,
  nemesisPairings,
  pairingQuestions,
  profiles,
  questions,
  rematchRequests,
  seasons,
} from '../schema/index.js';
import type { NemesisPairingRow, SharedPick, SharedQuestionPicks } from './moderation.js';
import type { MarketRow } from './questions.js';

export type SeasonRow = typeof seasons.$inferSelect;
export type NewSeasonRow = typeof seasons.$inferInsert;
// `NemesisPairingRow` is already exported by `./moderation.js` (WS11-T3) — re-declaring it here
// under the same name would collide via this package's `export *` barrel, so this file imports
// (rather than redefines) it and only adds the `Insert` variant moderation.ts didn't need.
export type NewNemesisPairingRow = typeof nemesisPairings.$inferInsert;
export type RematchRequestRow = typeof rematchRequests.$inferSelect;

// --- Seasons (§8.4 step 0) ----------------------------------------------------------------------

/** The `nemesis` season (if any) whose `[starts_on, ends_on]` covers `dateStr` (YYYY-MM-DD). */
export async function getNemesisSeasonCoveringDate(db: Db, dateStr: string): Promise<SeasonRow | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.kind, 'nemesis'), lte(seasons.startsOn, dateStr), gte(seasons.endsOn, dateStr)))
    .orderBy(asc(seasons.startsOn))
    .limit(1);
  return row ?? null;
}

export async function insertSeason(db: Db, row: NewSeasonRow): Promise<SeasonRow> {
  const [inserted] = await db.insert(seasons).values(row).returning();
  if (!inserted) throw new Error('insertSeason: no row returned');
  return inserted;
}

/**
 * Get-or-create the `nemesis` season covering `dateStr` (YYYY-MM-DD) — the §8.4 step-0 season
 * check ("assignment never silently no-ops on a season boundary"), extracted here so both
 * `nemesis:assign` (which resolves the CURRENT week) and call-out accept (WS20-T3, which resolves
 * a NEXT-week Monday) share one canonical get-or-create instead of duplicating it. A freshly
 * created season starts at `dateStr` and runs `NEMESIS_SEASON_WEEKS` weeks, matching
 * `nemesis-assign.ts`'s original inline shape. Returns `created` so the caller can log/notify.
 *
 * Not transactional against a concurrent creator (mirrors the original inline code — the weekly
 * `nemesis:assign` cron is a pg-boss singleton, and call-out accepts are rare enough that a lost
 * race just means a redundant season INSERT, which the caller can tolerate). If a stricter
 * guarantee is ever needed, an advisory lock on `('nemesis-season', dateStr)` is the seam.
 */
export async function getOrCreateNemesisSeasonCovering(
  db: Db,
  dateStr: string,
): Promise<{ season: SeasonRow; created: boolean }> {
  const existing = await getNemesisSeasonCoveringDate(db, dateStr);
  if (existing) return { season: existing, created: false };
  const season = await insertSeason(db, {
    id: uuidv7(),
    kind: 'nemesis',
    startsOn: dateStr,
    endsOn: addDaysToDateString(dateStr, NEMESIS_SEASON_WEEKS * 7 - 1),
    name: `Nemesis Season (${dateStr})`,
  });
  return { season, created: true };
}

// --- Eligible pool (§8.4) -----------------------------------------------------------------------

export interface NemesisPoolRow {
  profileId: string;
  handle: string;
  rating: number;
  rd: number;
  matchmakingPriority: boolean;
  /** IANA zone or null (§5.2 `profiles.timezone`) — the caller derives a UTC offset (§8.4 TZ_BONUS). */
  timezone: string | null;
  chalk: number;
  contrarian: number;
  timing: number;
  categoryShares: Partial<Record<MarketCategory, number>>;
}

/**
 * §8.4 eligible pool: claimed, `status='active'`, not nemesis-paused
 * (`settings.nemesis_paused !== true` — the PRD §4.2 user opt-out, distinct from the admin/
 * auto-pause `status='paused_matchmaking'` which `status='active'` already excludes), ≥
 * `minGradedPicks` graded (win/loss) picks, `bot_score < botExcludeThreshold`. Ratings/
 * fingerprints default neutrally (1500/350 rating, 0 style axes, `{}` category shares) when no
 * row exists yet — those nightly jobs (WS4-T7) may not have run for a freshly-eligible profile,
 * same zero-vector-guard spirit as `apps/worker/src/jobs/duo-matchmaker.ts`.
 *
 * WS20-T3 (D-J5) call-out guard: a profile that already holds a `scheduled`/`active`
 * `nemesis_pairings` row for `weekStart` is excluded from the organic pool for that week — a
 * call-out accepted last week mints exactly such a next-week pairing (canonical `nemesis_pairings`
 * row), so this single `NOT EXISTS` clause keeps Monday matchmaking from double-assigning anyone
 * who already has a locked-in opponent (via call-out OR a prior partial run) for the week being
 * assigned. Uses the `nemesis_pairings_status_week_idx` (status, week_start) index.
 */
export async function listNemesisEligiblePool(
  db: Db,
  botExcludeThreshold: number,
  minGradedPicks: number,
  weekStart: string,
): Promise<NemesisPoolRow[]> {
  const rows = await db.execute(sql`
    SELECT
      p.id AS profile_id,
      p.handle,
      COALESCE(r.glicko_rating, 1500) AS rating,
      COALESCE(r.glicko_rd, 350) AS rd,
      p.matchmaking_priority,
      p.timezone,
      COALESCE(f.chalk, 0) AS chalk,
      COALESCE(f.contrarian, 0) AS contrarian,
      COALESCE(f.timing, 0) AS timing,
      f.category_shares
    FROM profiles p
    LEFT JOIN ratings r ON r.profile_id = p.id
    LEFT JOIN fingerprints f ON f.profile_id = p.id
    WHERE p.kind = 'claimed'
      AND p.status = 'active'
      AND p.bot_score < ${botExcludeThreshold}
      AND (p.settings->>'nemesis_paused')::boolean IS NOT TRUE
      AND (SELECT count(*) FROM picks pk WHERE pk.profile_id = p.id AND pk.result IN ('win', 'loss')) >= ${minGradedPicks}
      AND NOT EXISTS (
        SELECT 1 FROM nemesis_pairings np
        WHERE np.week_start = ${weekStart}::date
          AND np.status IN ('scheduled', 'active')
          AND (np.profile_a_id = p.id OR np.profile_b_id = p.id)
      )
  `);
  return rows.rows.map((r) => ({
    profileId: r['profile_id'] as string,
    handle: r['handle'] as string,
    rating: Number(r['rating']),
    rd: Number(r['rd']),
    matchmakingPriority: r['matchmaking_priority'] === true,
    timezone: (r['timezone'] as string | null) ?? null,
    chalk: Number(r['chalk']),
    contrarian: Number(r['contrarian']),
    timing: Number(r['timing']),
    categoryShares: (r['category_shares'] as Partial<Record<MarketCategory, number>> | null) ?? {},
  }));
}

/** Every `blocks` row as an unordered pair — direction-agnostic exclusion (§5.6/§8.4 step 1). */
export async function listAllBlockedPairs(db: Db): Promise<Array<readonly [string, string]>> {
  const rows = await db.select({ a: blocks.blockerProfileId, b: blocks.blockedProfileId }).from(blocks);
  return rows.map((r) => [r.a, r.b] as const);
}

/** Every profile pair already paired this season (any status) — §8.4 step 1 "not previously
 * paired this season" (repeats are excluded from ORGANIC matching; rematches deliberately
 * bypass this via `constraints.forcedPairs`, which the pure matcher never checks against it). */
export async function listPairedProfilePairsForSeason(
  db: Db,
  seasonId: string,
): Promise<Array<readonly [string, string]>> {
  const rows = await db
    .select({ a: nemesisPairings.profileAId, b: nemesisPairings.profileBId })
    .from(nemesisPairings)
    .where(eq(nemesisPairings.seasonId, seasonId));
  return rows.map((r) => [r.a, r.b] as const);
}

// --- Rematch requests (§5.5, §8.4 step 0) ------------------------------------------------------

export async function listAcceptedRematchRequests(db: Db): Promise<RematchRequestRow[]> {
  return db.select().from(rematchRequests).where(eq(rematchRequests.status, 'accepted'));
}

export async function listOpenRematchRequestIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: rematchRequests.id })
    .from(rematchRequests)
    .where(eq(rematchRequests.status, 'open'));
  return rows.map((r) => r.id);
}

/**
 * §5.5: "Any request not mutually accepted by the next `nemesis:assign` run is set `expired` by
 * that run." `rematch_status` has no dedicated "fulfilled" terminal value (open/accepted/
 * declined/expired only — a genuine schema gap, not fixed here per the contract-change policy
 * for a P1-scope task; flagged in the WS5-T1 PR description) — accepted requests that DID
 * produce a forced pairing this run are also swept into `expired` here so the same accepted row
 * can never re-force a pairing on a LATER run (an unconditional standing rematch was judged the
 * less plausible reading of "next assignment run pairs them", singular).
 * SPEC-GAP(ws5-t1): a dedicated `fulfilled` rematch_status would be the cleaner long-term fix.
 */
export async function markRematchRequestsExpired(db: Db, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(rematchRequests).set({ status: 'expired' }).where(inArray(rematchRequests.id, ids));
}

// --- Rematch requests: WRITE path (§9.2 `POST /rematch-requests*`, WS5-T5) --------------------
//
// The functions above (`listAcceptedRematchRequests`, `listOpenRematchRequestIds`,
// `markRematchRequestsExpired`) are `nemesis:assign`'s READ/consume side (WS5-T1, already
// shipped). Everything below is the REQUEST side WS5-T5 owns: a claimed profile creating a
// request and the target accepting/declining it — `apps/web/lib/nemesis/rematch.ts` is the
// only caller.

export interface NewRematchRequestInput {
  id: string;
  requesterProfileId: string;
  targetProfileId: string;
  seasonId: string;
}

export async function insertRematchRequest(db: Db, input: NewRematchRequestInput): Promise<RematchRequestRow> {
  const [inserted] = await db
    .insert(rematchRequests)
    .values({
      id: input.id,
      requesterProfileId: input.requesterProfileId,
      targetProfileId: input.targetProfileId,
      seasonId: input.seasonId,
      status: 'open',
    })
    .returning();
  if (!inserted) throw new Error('insertRematchRequest: no row returned');
  return inserted;
}

/** The requester's own currently-`open` request to this exact target, if any — makes `POST
 * /rematch-requests` idempotent (a repeat click/retry returns the same row rather than piling
 * up duplicate open requests to the same opponent, mirroring `insertBlock`'s re-block posture). */
export async function findOpenRematchRequestFromTo(
  db: Db,
  requesterProfileId: string,
  targetProfileId: string,
): Promise<RematchRequestRow | null> {
  const [row] = await db
    .select()
    .from(rematchRequests)
    .where(
      and(
        eq(rematchRequests.requesterProfileId, requesterProfileId),
        eq(rematchRequests.targetProfileId, targetProfileId),
        eq(rematchRequests.status, 'open'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getRematchRequestById(db: Db, id: string): Promise<RematchRequestRow | null> {
  const [row] = await db.select().from(rematchRequests).where(eq(rematchRequests.id, id)).limit(1);
  return row ?? null;
}

/** `accept`/`decline` (§9.2 `POST /rematch-requests/:id/accept|decline`) — `null` if `id` no
 * longer names an `open` request (already resolved, or never existed); the caller distinguishes
 * "not found" from "already resolved" itself via a preceding `getRematchRequestById` read. */
export async function updateRematchRequestStatus(
  db: Db,
  id: string,
  status: 'accepted' | 'declined',
): Promise<RematchRequestRow | null> {
  const [row] = await db
    .update(rematchRequests)
    .set({ status })
    .where(and(eq(rematchRequests.id, id), eq(rematchRequests.status, 'open')))
    .returning();
  return row ?? null;
}

/**
 * §14.3 block integration: an `open` rematch request between two profiles that just became
 * mutually blocked can never be honored (`nemesis:assign`'s `buildForcedPairs` already silently
 * drops a forced pair once either side is in `blockedKeys` — see `nemesis-assign.ts`) — this
 * resolves it eagerly to `declined` at block time rather than leaving it visibly "pending" for
 * up to a week until the next `nemesis:assign` sweep expires it (§5.5). Direction-agnostic
 * (checks both `(a requested b)` and `(b requested a)`); a no-op if neither exists.
 */
export async function declineOpenRematchRequestsBetween(db: Db, profileAId: string, profileBId: string): Promise<void> {
  await db
    .update(rematchRequests)
    .set({ status: 'declined' })
    .where(
      and(
        eq(rematchRequests.status, 'open'),
        or(
          and(eq(rematchRequests.requesterProfileId, profileAId), eq(rematchRequests.targetProfileId, profileBId)),
          and(eq(rematchRequests.requesterProfileId, profileBId), eq(rematchRequests.targetProfileId, profileAId)),
        ),
      ),
    );
}

/**
 * Every rematch request (any status) involving `profileId` as either side, where the other side
 * is in `opponentIds` — the batched lookup `getNemesisHistoryPage` (§9.2 `GET
 * /me/nemesis-history`) uses to fold each history row's `rematch_request` state (this file's
 * sibling schema addition in `@receipts/core`) into one query per history page instead of one
 * per row. Ordered newest-first so the caller's "most relevant" reduction (prefer `open`, else
 * most recent) can just take the first match per opponent.
 */
export async function listRematchRequestsInvolving(
  db: Db,
  profileId: string,
  opponentIds: readonly string[],
): Promise<RematchRequestRow[]> {
  if (opponentIds.length === 0) return [];
  return db
    .select()
    .from(rematchRequests)
    .where(
      or(
        and(eq(rematchRequests.requesterProfileId, profileId), inArray(rematchRequests.targetProfileId, [...opponentIds])),
        and(eq(rematchRequests.targetProfileId, profileId), inArray(rematchRequests.requesterProfileId, [...opponentIds])),
      ),
    )
    .orderBy(desc(rematchRequests.createdAt));
}

/**
 * Was `targetProfileId` a past nemesis of `requesterProfileId` **this season** (§9.2 `POST
 * /rematch-requests` rule: "target must be a past nemesis this season")? "Past" = a terminal
 * (`completed`/`cancelled`, §5.7) pairing — an `active` current pairing doesn't need a rematch
 * *request*, and `scheduled` never happens for nemesis (§5.7). Direction-agnostic (canonical
 * `profile_a < profile_b` ordering, §5.5, means either could be `a` or `b`).
 */
export async function wasNemesisThisSeason(
  db: Db,
  requesterProfileId: string,
  targetProfileId: string,
  seasonId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: nemesisPairings.id })
    .from(nemesisPairings)
    .where(
      and(
        eq(nemesisPairings.seasonId, seasonId),
        inArray(nemesisPairings.status, ['completed', 'cancelled']),
        or(
          and(eq(nemesisPairings.profileAId, requesterProfileId), eq(nemesisPairings.profileBId, targetProfileId)),
          and(eq(nemesisPairings.profileAId, targetProfileId), eq(nemesisPairings.profileBId, requesterProfileId)),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}

// --- Pairing persistence -------------------------------------------------------------------------

export async function insertNemesisPairingRow(db: Db, row: NewNemesisPairingRow): Promise<NemesisPairingRow> {
  const [inserted] = await db.insert(nemesisPairings).values(row).returning();
  if (!inserted) throw new Error('insertNemesisPairingRow: no row returned');
  return inserted;
}

export async function insertPairingQuestionRows(
  db: Db,
  pairingId: string,
  questionIds: readonly string[],
): Promise<void> {
  if (questionIds.length === 0) return;
  await db
    .insert(pairingQuestions)
    .values(questionIds.map((questionId) => ({ pairingId, questionId })))
    .onConflictDoNothing();
}

/** §8.4 step 4: bulk-set/clear `profiles.matchmaking_priority` (server-only column, §5.2). */
export async function setMatchmakingPriority(db: Db, profileIds: readonly string[], value: boolean): Promise<void> {
  if (profileIds.length === 0) return;
  await db
    .update(profiles)
    .set({ matchmakingPriority: value, updatedAt: new Date() })
    .where(inArray(profiles.id, profileIds));
}

// --- Bonus questions (§8.8.1) --------------------------------------------------------------------

/** An already-`open` `nemesis_bonus` question for `marketId`, if one exists (§8.8.1 dedup: "the
 * pairing/match reuses it"). */
export async function findOpenNemesisBonusQuestionForMarket(db: Db, marketId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.marketId, marketId), eq(questions.kind, 'nemesis_bonus'), eq(questions.status, 'open')))
    .limit(1);
  return row ?? null;
}

/**
 * Candidate `nemesis_eligible` markets whose `close_time` falls within the nemesis week (§8.8:
 * "markets resolving within the week"), in the given category, still `open`. Ordered by
 * `close_time` so the earliest-resolving candidate (best chance of settling before
 * `nemesis:conclude`) is preferred within a category.
 */
export async function listNemesisEligibleMarketsForCategory(
  db: Db,
  category: MarketCategory,
  weekStartUtc: Date,
  weekEndUtc: Date,
  limit: number,
): Promise<MarketRow[]> {
  return db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.category, category),
        eq(markets.status, 'open'),
        eq(markets.nemesisEligible, true),
        gte(markets.closeTime, weekStartUtc),
        lte(markets.closeTime, weekEndUtc),
      ),
    )
    .orderBy(asc(markets.closeTime))
    .limit(limit);
}

// --- Mid-week exit (§5.7, §14.3) -----------------------------------------------------------------

/**
 * The FULL shared-question set for a pairing's mid-week exit scoring (§8.8): the week's derived
 * dailies (`question_date` in `[weekStart, weekEnd]`) UNION the pairing's `nemesis_bonus`
 * questions (`pairing_questions`). `getPairingSharedQuestionPicks` (this file's sibling in
 * `moderation.ts`, WS11-T3) only covers the bonus half — dailies dominate a real week (7 vs 0–3
 * bonus), so a mid-week exit that only ever counted bonus picks would silently under-score
 * almost every early conclusion. Added here (additive, new function) rather than editing
 * WS11-T3's existing helper in place, to avoid touching that already-merged call site; flagged
 * prominently in the WS5-T1 PR description as a correctness gap this closes for any caller that
 * switches to it.
 */
/**
 * Build a `SharedPick` from a raw pick row, including the D-J4 same-side inputs (WS20-T1): the
 * taken side, its implied entry cost in integer cents (yes → yes-price¢, no → (100−yes)¢), and
 * the price stamp as epoch ms for the same-minute tiebreak.
 */
function buildSharedPick(row: Record<string, unknown>): SharedPick {
  const side = row['pick_side'] as 'yes' | 'no';
  const yesPrice = Number(row['pick_yes_price'] ?? 0);
  const entryCents = Math.round((side === 'yes' ? yesPrice : 1 - yesPrice) * 100);
  const stampedAt = row['pick_stamped_at'] as string | null;
  return {
    picked: true,
    won: row['pick_result'] === 'win',
    edge: Number(row['pick_edge'] ?? 0),
    side,
    entryCents,
    priceStampedAtMs: stampedAt ? new Date(stampedAt).getTime() : undefined,
  };
}

export async function getFullPairingSharedQuestionPicks(
  db: Db,
  pairing: { id: string; weekStart: string; weekEnd: string },
  profileAId: string,
  profileBId: string,
): Promise<SharedQuestionPicks[]> {
  const rows = await db.execute(sql`
    SELECT
      q.id AS question_id,
      q.status AS status,
      pk.profile_id AS pick_profile_id,
      pk.result AS pick_result,
      pk.edge AS pick_edge,
      pk.side AS pick_side,
      pk.yes_price_at_entry AS pick_yes_price,
      pk.price_stamped_at AS pick_stamped_at
    FROM questions q
    LEFT JOIN picks pk
      ON pk.question_id = q.id AND pk.profile_id IN (${profileAId}, ${profileBId})
    WHERE
      (q.kind = 'daily' AND q.question_date BETWEEN ${pairing.weekStart}::date AND ${pairing.weekEnd}::date)
      OR q.id IN (SELECT question_id FROM pairing_questions WHERE pairing_id = ${pairing.id})
  `);

  const byQuestion = new Map<string, SharedQuestionPicks>();
  for (const row of rows.rows) {
    const questionId = row['question_id'] as string;
    const status = row['status'] as string;
    const existing =
      byQuestion.get(questionId) ??
      ({
        questionId,
        isVoid: status === 'voided',
        isSettled: status === 'revealed' || status === 'voided',
        profileAPick: { picked: false, won: false, edge: 0 },
        profileBPick: { picked: false, won: false, edge: 0 },
      } satisfies SharedQuestionPicks);

    const pickProfileId = row['pick_profile_id'] as string | null;
    if (pickProfileId === profileAId) {
      existing.profileAPick = buildSharedPick(row);
    } else if (pickProfileId === profileBId) {
      existing.profileBPick = buildSharedPick(row);
    }
    byQuestion.set(questionId, existing);
  }
  return [...byQuestion.values()];
}

// --- WS9-T3's mock-start read (kept verbatim, see file header) ----------------------------------

export interface ActiveNemesisPairing {
  id: string;
  weekStart: string;
  profileAId: string;
  profileBId: string;
  scoreA: number;
  scoreB: number;
}

/** Pairings currently `status = 'active'` — the mock-start query for `nemesis:lastday` (§7.6). */
export async function listActiveNemesisPairings(db: Db): Promise<ActiveNemesisPairing[]> {
  const rows = await db
    .select({
      id: nemesisPairings.id,
      weekStart: nemesisPairings.weekStart,
      profileAId: nemesisPairings.profileAId,
      profileBId: nemesisPairings.profileBId,
      scoreA: nemesisPairings.scoreA,
      scoreB: nemesisPairings.scoreB,
    })
    .from(nemesisPairings)
    .where(eq(nemesisPairings.status, 'active'));
  return rows;
}
