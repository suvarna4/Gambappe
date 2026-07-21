/**
 * WS19-T2 · Server-side assembly of the Sweat room's open-position list (`/sweat`, D-J3),
 * read straight from Postgres — the same SSR-reads-the-DB-directly pattern `question-view.ts`
 * documents (server components read `@receipts/db` rather than self-fetching their own API).
 * `/sweat` is force-dynamic and viewer-scoped, so unlike the ISR question page there is no
 * INV-10 concern with reading the viewer's own picks here.
 *
 * A "position" is one of the viewer's `pending` (ungraded) picks joined to its question and the
 * underlying venue market: the headline, the held side + stamped entry price, the live price
 * drift, and the settle-when label. Ordering is soonest-to-settle first. Pure label/drift maths
 * lives in `sweat.ts` (unit-tested there); this module only does the join and the sort.
 */
import { and, eq } from 'drizzle-orm';
import { markets, picks, questions, type Db } from '@receipts/db';
import {
  heldSideDrift,
  impliedHeldCents,
  settleWhenLabel,
  SETTLE_WHEN_ORDER,
  type HeldDrift,
  type SettleWhen,
} from './sweat';

export interface SweatPosition {
  pickId: string;
  /** Question slug for the row's deep link (`/q/[slug]`); null questions have no public page. */
  slug: string | null;
  headline: string;
  side: 'yes' | 'no';
  /** The venue label for the held side (`question.yes_label`/`no_label`). */
  sideLabel: string;
  /** Implied entry cost of the held side, in integer cents. */
  entryCents: number;
  drift: HeldDrift;
  settleWhen: SettleWhen;
  /** The market close instant (ISO) — the sort key backing "soonest-first". */
  closeIso: string;
}

/**
 * The viewer's open positions (`pending` picks), joined to questions + markets and ordered
 * soonest-to-settle first. `nowMsValue` is the shared `@receipts/core` server clock (passed in,
 * never read here) so the settle-when labels are deterministic within a render.
 */
export async function getSweatPositions(
  db: Db,
  profileId: string,
  nowMsValue: number,
): Promise<SweatPosition[]> {
  const rows = await db
    .select({ pick: picks, question: questions, market: markets })
    .from(picks)
    .innerJoin(questions, eq(picks.questionId, questions.id))
    .innerJoin(markets, eq(questions.marketId, markets.id))
    .where(and(eq(picks.profileId, profileId), eq(picks.result, 'pending')));

  const positions: SweatPosition[] = rows.map(({ pick, question, market }) => {
    const side = pick.side;
    const sideLabel = side === 'yes' ? question.yesLabel : question.noLabel;
    const closeIso = market.closeTime.toISOString();
    return {
      pickId: pick.id,
      slug: question.slug,
      headline: question.headline,
      side,
      sideLabel,
      entryCents: impliedHeldCents(side, pick.yesPriceAtEntry),
      drift: heldSideDrift(side, pick.yesPriceAtEntry, market.yesPrice ?? null),
      settleWhen: settleWhenLabel(closeIso, nowMsValue),
      closeIso,
    };
  });

  // Soonest-first: the settle-when kind (LIVE → weekday → month) then the raw close instant as a
  // stable tiebreak within a kind. Ascending close instant alone would produce the same order;
  // the explicit kind key just documents the grouping the labels imply.
  positions.sort((a, b) => {
    const byKind = SETTLE_WHEN_ORDER[a.settleWhen.kind] - SETTLE_WHEN_ORDER[b.settleWhen.kind];
    if (byKind !== 0) return byKind;
    return Date.parse(a.closeIso) - Date.parse(b.closeIso);
  });

  return positions;
}
