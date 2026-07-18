import type { QuestionRow } from "./serialize";

interface QuestionTableRow {
  id: string;
  kind: string;
  headline: string;
  status: QuestionRow["status"];
  opensAt: Date;
  locksAt: Date;
  revealAt: Date | null;
  revealedAt: Date | null;
  crowdYes: number;
  crowdNo: number;
  crowdYesAtLock: number | null;
  crowdNoAtLock: number | null;
  priceYesAtLock: string | null;
  priceYesAtSettle: string | null;
}

interface MarketTableRow {
  category: string;
  yesLabel: string;
  noLabel: string;
  url: string;
  lastPriceYes: string | null;
  priceUpdatedAt: Date | null;
  outcome: "yes" | "no" | "void" | null;
}

/** Joins a `questions` row + its `markets` row into the shape publicQuestion() expects. */
export function toQuestionRow(q: QuestionTableRow, m: MarketTableRow): QuestionRow {
  return {
    id: q.id,
    kind: q.kind,
    headline: q.headline,
    yesLabel: m.yesLabel,
    noLabel: m.noLabel,
    category: m.category,
    status: q.status,
    opensAt: q.opensAt,
    locksAt: q.locksAt,
    revealAt: q.revealAt,
    revealedAt: q.revealedAt,
    crowdYes: q.crowdYes,
    crowdNo: q.crowdNo,
    crowdYesAtLock: q.crowdYesAtLock,
    crowdNoAtLock: q.crowdNoAtLock,
    priceYesAtLock: q.priceYesAtLock,
    priceYesAtSettle: q.priceYesAtSettle,
    venueUrl: m.url,
    priceYes: m.lastPriceYes,
    priceUpdatedAt: m.priceUpdatedAt,
    outcome: m.outcome,
  };
}
