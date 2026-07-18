/**
 * `duo:matchmaker` (WS6-T1; §8.5). Partner matching for the duo queue: for the longest-waiting
 * `waiting` entry, find the best-`complementarity` in-band candidate among the OTHER waiting
 * entries (excluding blocked pairs and not-yet-re-eligible prior partners), and on a match,
 * create a `duos` row (team rating = mean of individuals, RD 350) inside one transaction,
 * marking both queue entries `matched`.
 *
 * The matching algorithm itself (band widening by wait time, complementarity) is WS4-T5's pure
 * `matchDuoPartner` / `duoRatingBand` in `@receipts/engine` — nothing here re-implements it or
 * its constants; this file is purely the DB-facing wiring: load the eligible pool, compute
 * exclusion sets, call the pure matcher, persist the result.
 *
 * Sub-minute cadence: §8.5 specifies a 30s tick, but pg-boss cron granularity is one minute
 * (see `registry.ts`'s header note). This handler self-requeues via `boss.send` with
 * `startAfter` + a debouncing `singletonKey`/`singletonSeconds` so at most one follow-up tick is
 * ever pending — see `duoMatchmakerHandler` below.
 */
import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { isFlagEnabled, now, type MarketCategory } from '@receipts/core';
import {
  blocks,
  duoQueueEntries,
  duos,
  fingerprints,
  notifications,
  profiles,
  ratings,
  type Db,
} from '@receipts/db';
import { matchDuoPartner, type DuoQueueCandidate, type DuoWaitingEntry } from '@receipts/engine';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

/** Glicko-2 seed default (§5.4 `ratings.glicko_rating`) — used when no `ratings` row exists yet
 * (that table is only populated once `ratings:weekly`/WS4-T7 lands). */
const DEFAULT_RATING = 1500;

interface PoolRow {
  entryId: string;
  profileId: string;
  enqueuedAt: Date;
  rating: number;
  chalk: number;
  categoryShares: Partial<Record<MarketCategory, number>>;
}

/**
 * Currently-`waiting` queue entries whose profile is still claimed+active. §8.5's eligibility
 * gate ("claimed, active, ...") is re-checked here, not just at join time (`joinDuoQueue`,
 * apps/web/lib/duo-queue.ts) — a profile that pauses matchmaking mid-wait simply stops being
 * selected as a head or candidate, rather than blocking the whole queue behind a now-ineligible
 * longest-waiter. Its row is left `waiting` (not auto-cancelled): §8.5/§9.2 don't specify that
 * transition, and the smallest defensible behavior is to leave it for the profile to explicitly
 * leave (`DELETE /duo/queue`) or resume (settings) rather than inventing an auto-cancel.
 */
async function loadWaitingPool(db: Db): Promise<PoolRow[]> {
  const rows = await db
    .select({
      entryId: duoQueueEntries.id,
      profileId: duoQueueEntries.profileId,
      enqueuedAt: duoQueueEntries.enqueuedAt,
      rating: ratings.glickoRating,
      chalk: fingerprints.chalk,
      categoryShares: fingerprints.categoryShares,
    })
    .from(duoQueueEntries)
    .innerJoin(profiles, eq(profiles.id, duoQueueEntries.profileId))
    .leftJoin(ratings, eq(ratings.profileId, duoQueueEntries.profileId))
    .leftJoin(fingerprints, eq(fingerprints.profileId, duoQueueEntries.profileId))
    .where(
      and(
        eq(duoQueueEntries.status, 'waiting'),
        eq(profiles.status, 'active'),
        eq(profiles.kind, 'claimed'),
      ),
    )
    .orderBy(asc(duoQueueEntries.enqueuedAt));

  return rows.map((r) => ({
    entryId: r.entryId,
    profileId: r.profileId,
    enqueuedAt: r.enqueuedAt,
    rating: r.rating ?? DEFAULT_RATING,
    // No fingerprint row yet (fingerprint:nightly/WS4-T7 not run for this profile) → neutral
    // style, same zero-vector-guard spirit as `packages/engine/src/style.ts`.
    chalk: r.chalk ?? 0,
    categoryShares: (r.categoryShares as Partial<Record<MarketCategory, number>> | null) ?? {},
  }));
}

/** True iff `profileId` has created a duo_queue_entries row (any status) after `since` — the
 * §8.5 "both have re-queued since disband" test. */
async function hasRequeuedSince(db: Db, profileId: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: duoQueueEntries.id })
    .from(duoQueueEntries)
    .where(and(eq(duoQueueEntries.profileId, profileId), gt(duoQueueEntries.enqueuedAt, since)))
    .limit(1);
  return row !== undefined;
}

/**
 * §8.5: profiles `profileId` may not currently be paired with — blocked either direction (§5.6:
 * "permanent matchmaking exclusion both directions"), plus prior duo partners not yet eligible
 * for a repeat (eligible again only once BOTH have re-queued since the duo was disbanded).
 *
 * `duos` has no dedicated `disbanded_at` column (§5.5); `updated_at` is used as the disband
 * timestamp proxy — disbanding (WS6-T4, not yet built) is the only status write a duo gets
 * after going active, so this holds as long as nothing else touches a disbanded duo row.
 */
async function computeExcludedPartnerIds(db: Db, profileId: string): Promise<Set<string>> {
  const excluded = new Set<string>();

  const blockRows = await db
    .select({ blocker: blocks.blockerProfileId, blocked: blocks.blockedProfileId })
    .from(blocks)
    .where(or(eq(blocks.blockerProfileId, profileId), eq(blocks.blockedProfileId, profileId)));
  for (const row of blockRows) {
    excluded.add(row.blocker === profileId ? row.blocked : row.blocker);
  }

  const priorDuos = await db
    .select()
    .from(duos)
    .where(
      and(or(eq(duos.profileAId, profileId), eq(duos.profileBId, profileId)), eq(duos.status, 'disbanded')),
    );

  for (const duo of priorDuos) {
    const partnerId = duo.profileAId === profileId ? duo.profileBId : duo.profileAId;
    const disbandedAt = duo.updatedAt;
    const [meRequeued, partnerRequeued] = await Promise.all([
      hasRequeuedSince(db, profileId, disbandedAt),
      hasRequeuedSince(db, partnerId, disbandedAt),
    ]);
    if (!(meRequeued && partnerRequeued)) {
      excluded.add(partnerId);
    }
  }

  return excluded;
}

/**
 * Creates the duo + marks both queue entries `matched` inside one transaction, row-locking the
 * two queue entries first to close the TOCTOU window between `loadWaitingPool` and this write
 * (the realistic race is an overlapping self-requeued tick, not concurrent single-row writers
 * like `picks`). Returns false if either entry lost the race (no longer `waiting`) — the caller
 * treats that as "no match this tick" rather than retrying, to keep the tick loop's termination
 * trivially bounded.
 */
async function createDuoFromMatch(db: Db, head: PoolRow, partner: PoolRow, at: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: duoQueueEntries.id, status: duoQueueEntries.status })
      .from(duoQueueEntries)
      .where(inArray(duoQueueEntries.id, [head.entryId, partner.entryId]))
      .for('update');

    if (locked.length !== 2 || locked.some((r) => r.status !== 'waiting')) {
      return false;
    }

    // Canonical order a < b by uuid (§5.5).
    const [profileAId, profileBId] =
      head.profileId < partner.profileId
        ? [head.profileId, partner.profileId]
        : [partner.profileId, head.profileId];

    const [duo] = await tx
      .insert(duos)
      .values({
        id: uuidv7(),
        profileAId,
        profileBId,
        status: 'active',
        tier: 1,
        // Team rating = mean of individuals; RD fixed at 350 (§8.5). glickoVol keeps the
        // schema default (0.06, §5.5) — §8.5 doesn't specify a different seed for it.
        glickoRating: (head.rating + partner.rating) / 2,
        glickoRd: 350,
      })
      .returning();
    if (!duo) throw new Error('createDuoFromMatch: no duo row returned');

    await tx
      .update(duoQueueEntries)
      .set({ status: 'matched', matchedDuoId: duo.id })
      .where(inArray(duoQueueEntries.id, [head.entryId, partner.entryId]));

    // Outbox notification (§5.6 "notifications — outbox pattern"). WS9 owns the real
    // `notify:dispatch` sender + per-user channel selection (settings.notifications.push_duo /
    // .email_duo already exist, packages/core/src/schemas/settings.ts); `notify:dispatch` is
    // still a stub as of this PR (apps/worker/src/jobs/stubs.ts). `channel: 'push'` is the
    // smallest defensible default for a real-time "you got matched" nudge pending that work.
    // SPEC-GAP(ws6-t1): §13.3's beat catalog (exact `kind` names/payload shapes) isn't in this
    // task's reading scope — `kind: 'duo_matched'` is a placeholder; WS9 should confirm/rename
    // it against the real catalog when it lands.
    await tx
      .insert(notifications)
      .values([
        {
          id: uuidv7(),
          profileId: head.profileId,
          kind: 'duo_matched',
          payload: { duo_id: duo.id, partner_profile_id: partner.profileId },
          channel: 'push',
          scheduledAt: at,
          dedupeKey: `duo_matched:${duo.id}:${head.profileId}`,
        },
        {
          id: uuidv7(),
          profileId: partner.profileId,
          kind: 'duo_matched',
          payload: { duo_id: duo.id, partner_profile_id: head.profileId },
          channel: 'push',
          scheduledAt: at,
          dedupeKey: `duo_matched:${duo.id}:${partner.profileId}`,
        },
      ])
      .onConflictDoNothing({ target: notifications.dedupeKey });

    return true;
  });
}

export interface DuoMatchmakerReport {
  /** Number of longest-waiting entries evaluated this tick. */
  evaluated: number;
  /** Number of duos created this tick. */
  matched: number;
}

/** Safety valve against a runaway loop from an unforeseen bug — never expected to bind in
 * practice (each successful match strictly shrinks the pool by 2; a failed match/no-match
 * breaks immediately). */
const MAX_TICK_ITERATIONS = 1000;

/**
 * One matchmaker tick (§8.5): repeatedly takes the current longest-waiting eligible entry and
 * attempts a match against the rest of the waiting pool, stopping as soon as an attempt fails
 * to find a partner (per §8.5's wording, only "the longest-waiting entry" is the tick's
 * subject) — so a tick drains as many pairs as it can while the head of the queue keeps
 * matching, rather than being capped at exactly one pair per 30s.
 */
export async function runDuoMatchmakerTick(db: Db, at: Date = now()): Promise<DuoMatchmakerReport> {
  const report: DuoMatchmakerReport = { evaluated: 0, matched: 0 };

  for (let i = 0; i < MAX_TICK_ITERATIONS; i++) {
    const pool = await loadWaitingPool(db);
    if (pool.length === 0) break;

    const [head, ...rest] = pool;
    if (!head) break;
    report.evaluated++;

    const excludedPartnerIds = await computeExcludedPartnerIds(db, head.profileId);
    const waitSeconds = Math.max(0, (at.getTime() - head.enqueuedAt.getTime()) / 1000);
    const waiting: DuoWaitingEntry = {
      profileId: head.profileId,
      rating: head.rating,
      chalk: head.chalk,
      categoryShares: head.categoryShares,
      waitSeconds,
      excludedPartnerIds,
    };
    // `waiting`'s exclusion set is already the full symmetric set (blocks + prior-partner
    // checks are queried both-directions from head's perspective, §8.5) — matchDuoPartner
    // checks both sides' sets, so leaving candidates' own sets empty is sufficient.
    const candidates: DuoQueueCandidate[] = rest.map((c) => ({
      profileId: c.profileId,
      rating: c.rating,
      chalk: c.chalk,
      categoryShares: c.categoryShares,
      excludedPartnerIds: new Set<string>(),
    }));

    const match = matchDuoPartner(waiting, candidates);
    if (!match) break;

    const partner = rest.find((c) => c.profileId === match.partnerId);
    if (!partner) break; // shouldn't happen — matchDuoPartner only returns ids from `candidates`

    const created = await createDuoFromMatch(db, head, partner, at);
    if (created) {
      report.matched++;
      continue; // pool changed — reload and continue draining
    }
    break; // lost the row-lock race — treat as no match this tick rather than retrying
  }

  return report;
}

const DUO_MATCHMAKER_QUEUE = 'duo:matchmaker';
/** §8.5 "30s tick" vs. pg-boss's 1-minute cron floor (registry.ts header note). */
const SELF_REQUEUE_DELAY_S = 30;
/** Wider than the delay so an overlapping cron-fired run and a self-requeued run don't both
 * schedule a follow-up — pg-boss debounces same-`singletonKey` sends within this window
 * (node_modules/pg-boss `manager.js` `createJob`/`getDebounceStartAfter`), which keeps this
 * self-requeue chain from ever compounding. */
const SELF_REQUEUE_SINGLETON_SECONDS = 45;
const SELF_REQUEUE_SINGLETON_KEY = 'duo:matchmaker:self-requeue';

export const duoMatchmakerHandler: JobHandler = async (ctx) => {
  if (!isFlagEnabled('duo_queue')) {
    logger.debug('duo:matchmaker skipped — duo_queue flag disabled');
    return;
  }

  const at = now();
  const report = await runDuoMatchmakerTick(ctx.db, at);
  logger.info({ report }, 'duo:matchmaker tick complete');

  await ctx.boss.send(
    DUO_MATCHMAKER_QUEUE,
    { selfRequeue: true },
    {
      startAfter: SELF_REQUEUE_DELAY_S,
      singletonKey: SELF_REQUEUE_SINGLETON_KEY,
      singletonSeconds: SELF_REQUEUE_SINGLETON_SECONDS,
    },
  );
};
