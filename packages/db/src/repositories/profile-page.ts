/**
 * Public profile page repository helpers (design doc §9.2 `GET /profiles/:slug` and
 * `GET /profiles/:slug/picks`, WS7-T4). Read-only: rating summary, the nemesis lifetime
 * record, and the paginated public pick log joined to its question for receipt display
 * (headline/labels). Business rules (masking a graded-but-unrevealed daily's result per §6.5,
 * minute-truncating `picked_at`, badge derivation) live in `apps/web/lib` (§4.3 — business
 * logic doesn't belong in the data-access layer); these helpers only fetch rows and joins.
 *
 * Fingerprint and wallet-link reads already have canonical homes elsewhere in this package
 * (`./fingerprints.js`'s `getFingerprintRow`, `./wallet-links.js`'s
 * `getActiveWalletLinkByProfileId` — both landed via WS12) — reused here rather than
 * duplicated, per `apps/web/lib/serialize-wallet.ts`'s own note that `GET /profiles/:slug`
 * should call its `toWalletBadge` rather than hand-rolling a second wallet projection.
 *
 * `./moderation.js` also has a rating reader (`getOrDefaultRating`) but it INSERTs a default
 * 1500/350/0.06 row when one is missing — a write side effect this read-only, publicly
 * cacheable page must never trigger (INV-10: a GET must not mutate). `getRatingByProfileId`
 * below is a plain SELECT that returns `null` when unrated, which is the correct public
 * signal ("no rating yet") rather than a synthesized default.
 */
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { nemesisPairings, picks, questions, ratings } from '../schema/index.js';
// Reuse the already-exported row types rather than re-exporting second bindings of the same
// name through the package's `export *` barrel (index.ts) — see picks.js/fingerprints.js/
// wallet-links.js/moderation.js for the canonical definitions.
import type { PickRow } from './picks.js';
import type { RatingRow } from './moderation.js';

export async function getRatingByProfileId(db: Db, profileId: string): Promise<RatingRow | null> {
  const [row] = await db.select().from(ratings).where(eq(ratings.profileId, profileId)).limit(1);
  return row ?? null;
}

export interface NemesisSummary {
  wins: number;
  losses: number;
  draws: number;
}

/** Lifetime nemesis record across completed pairings on either side of the canonical pair (§5.5). */
export async function getNemesisSummaryForProfile(
  db: Db,
  profileId: string,
): Promise<NemesisSummary> {
  const rows = await db
    .select({ winnerProfileId: nemesisPairings.winnerProfileId })
    .from(nemesisPairings)
    .where(
      and(
        eq(nemesisPairings.status, 'completed'),
        or(eq(nemesisPairings.profileAId, profileId), eq(nemesisPairings.profileBId, profileId)),
      ),
    );
  const summary: NemesisSummary = { wins: 0, losses: 0, draws: 0 };
  for (const row of rows) {
    if (row.winnerProfileId === null) summary.draws += 1;
    else if (row.winnerProfileId === profileId) summary.wins += 1;
    else summary.losses += 1;
  }
  return summary;
}

/**
 * Lifetime count of the profile's "called it" picks (§6.7: a public, publicly-resolved win at
 * an implied entry probability ≤ the longshot threshold). `longshotThreshold` is passed in by
 * the caller (`LONGSHOT_THRESHOLD`, `@receipts/core`) rather than hardcoded here.
 * "Publicly resolved" mirrors the §6.5 publication rule: bonus questions (`kind != 'daily'`)
 * publish immediately; a `daily` question only counts once `revealed` or `voided` — never leak
 * a pre-reveal win through the badge list or the graveyard trophy count.
 *
 * One query serves both §9.2 consumers: the `called_it` badge (`count > 0`, WS7-T4) and the
 * `ProfilePublic.graveyard.called_it_count` trophy (SW9-T3) — a separate boolean probe would
 * just duplicate this predicate.
 */
export async function countCalledItPicks(
  db: Db,
  profileId: string,
  longshotThreshold: number,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(picks)
    .innerJoin(questions, eq(picks.questionId, questions.id))
    .where(
      and(
        eq(picks.profileId, profileId),
        eq(picks.isPublic, true),
        eq(picks.result, 'win'),
        sql`(${questions.kind} <> 'daily' OR ${questions.status} IN ('revealed', 'voided'))`,
        sql`(CASE WHEN ${picks.side} = 'yes' THEN ${picks.yesPriceAtEntry} ELSE 1 - ${picks.yesPriceAtEntry} END) <= ${longshotThreshold}`,
      ),
    );
  return row?.count ?? 0;
}

/** Opaque cursor: the last row's (picked_at, id) — the log's own sort key, newest first. */
export interface ProfilePicksCursor {
  pickedAt: string;
  id: string;
}

export interface ProfilePickQuestionRef {
  id: string;
  kind: (typeof questions.$inferSelect)['kind'];
  status: (typeof questions.$inferSelect)['status'];
  slug: string | null;
  headline: string;
  yesLabel: string;
  noLabel: string;
  questionDate: string | null;
  revealedAt: Date | null;
}

export interface ProfilePickWithQuestion {
  pick: PickRow;
  question: ProfilePickQuestionRef;
}

/**
 * The public pick log (receipts culture, INV-6, §9.2 `GET /profiles/:slug(/picks)`):
 * `is_public` only, newest first, joined to its question for receipt display (headline,
 * side labels). Masking the result of a graded-but-unrevealed daily and minute-truncating
 * `picked_at` are the caller's job (§4.3 — data access stays dumb).
 */
export async function listPublicPicksForProfile(
  db: Db,
  profileId: string,
  cursor: ProfilePicksCursor | null,
  limit: number,
): Promise<ProfilePickWithQuestion[]> {
  const conditions = [eq(picks.profileId, profileId), eq(picks.isPublic, true)];
  if (cursor) {
    conditions.push(
      sql`(${picks.pickedAt}, ${picks.id}) < (${cursor.pickedAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select({
      pick: picks,
      question: {
        id: questions.id,
        kind: questions.kind,
        status: questions.status,
        slug: questions.slug,
        headline: questions.headline,
        yesLabel: questions.yesLabel,
        noLabel: questions.noLabel,
        questionDate: questions.questionDate,
        revealedAt: questions.revealedAt,
      },
    })
    .from(picks)
    .innerJoin(questions, eq(picks.questionId, questions.id))
    .where(and(...conditions))
    .orderBy(desc(picks.pickedAt), desc(picks.id))
    .limit(limit);
  return rows;
}
