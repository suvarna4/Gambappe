import { CONSTANTS } from "@/shared/constants";

/**
 * §8.1 — the ONE allowlist-based serializer file. Never spread raw DB
 * rows into a response (INV-6). Status-conditional fields are gated
 * exactly as specified here; nothing outside these functions may shape
 * a public/me payload.
 */

type QuestionStatus = "draft" | "open" | "locked" | "graded" | "revealed" | "voided";

export interface UserRow {
  handle: string;
  kind: "ghost" | "pending" | "claimed";
  createdAt: Date;
}

export interface UserStatsRow {
  participationStreak: number;
  bestParticipationStreak: number;
  winStreak: number;
  bestWinStreak: number;
  wins: number;
  picksResolved: number;
  edgeSum: string | number;
  categoryStats: unknown;
}

function calledItCount(_stats: UserStatsRow | null): number {
  // MVP: derived from pick log at call sites where needed; kept 0 here
  // to avoid an extra query in the common profile-header path.
  return 0;
}

export function publicUser(user: UserRow, stats: UserStatsRow | null) {
  const accuracy = stats && stats.picksResolved > 0 ? stats.wins / stats.picksResolved : null;
  const edge = stats && stats.picksResolved > 0 ? Number(stats.edgeSum) / stats.picksResolved : null;
  return {
    handle: user.handle,
    kind: user.kind,
    createdAt: user.createdAt.toISOString(),
    stats: {
      accuracy,
      edge,
      participationStreak: stats?.participationStreak ?? 0,
      bestParticipationStreak: stats?.bestParticipationStreak ?? 0,
      winStreak: stats?.winStreak ?? 0,
      bestWinStreak: stats?.bestWinStreak ?? 0,
      calledItCount: calledItCount(stats),
      categoryStats: (stats?.categoryStats as Record<string, { picks: number; wins: number }>) ?? {},
    },
    badges: [] as string[],
  };
}

export interface QuestionRow {
  id: string;
  kind: string;
  headline: string;
  yesLabel: string;
  noLabel: string;
  category: string;
  status: QuestionStatus;
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
  venueUrl: string;
  priceYes: string | null;
  priceUpdatedAt: Date | null;
  outcome: "yes" | "no" | "void" | null;
}

export function publicQuestion(q: QuestionRow) {
  const base = {
    id: q.id,
    kind: q.kind,
    headline: q.headline,
    yesLabel: q.yesLabel,
    noLabel: q.noLabel,
    category: q.category,
    status: q.status,
    opensAt: q.opensAt.toISOString(),
    locksAt: q.locksAt.toISOString(),
    venueUrl: q.venueUrl,
    participantCount: q.crowdYes + q.crowdNo,
  } as Record<string, unknown>;

  if (q.status === "open") {
    base.priceYes = q.priceYes !== null ? Number(q.priceYes) : null;
    base.priceAsOf = q.priceUpdatedAt ? q.priceUpdatedAt.toISOString() : null;
  }

  if (["locked", "graded", "revealed"].includes(q.status)) {
    base.crowdYesAtLock = q.crowdYesAtLock;
    base.crowdNoAtLock = q.crowdNoAtLock;
    base.priceYesAtLock = q.priceYesAtLock !== null ? Number(q.priceYesAtLock) : null;
  }

  if (q.status === "graded" || q.status === "revealed") {
    base.revealAt = q.revealAt ? q.revealAt.toISOString() : null;
  }

  if (q.status === "revealed") {
    base.outcome = q.outcome;
    base.priceYesAtSettle = q.priceYesAtSettle !== null ? Number(q.priceYesAtSettle) : null;
    base.revealedAt = q.revealedAt ? q.revealedAt.toISOString() : null;
  }

  return base;
}

export interface PickRow {
  handle: string;
  side: "yes" | "no";
  entryPrice: string;
  pickedAt: Date;
  result: "pending" | "win" | "loss" | "void";
}

/** D-16: side/entry/pickedAt visible only once the question is locked+; result only once revealed. */
export function publicPick(p: PickRow, questionStatus: QuestionStatus) {
  if (!["locked", "graded", "revealed"].includes(questionStatus)) return null;
  const base: Record<string, unknown> = {
    handle: p.handle,
    side: p.side,
    entryPrice: Number(p.entryPrice),
    pickedAt: p.pickedAt.toISOString(),
  };
  if (questionStatus === "revealed") base.result = p.result;
  return base;
}

export function meUser(
  user: UserRow & { email: string | null; id: string },
  stats: UserStatsRow | null,
  picksResolvedTotal: number
) {
  return {
    ...publicUser(user, stats),
    email: user.email,
    eligibility: {
      nemesisEligible: picksResolvedTotal >= CONSTANTS.NEMESIS_MIN_PICKS,
      picksResolvedTotal,
      nemesisMinPicks: CONSTANTS.NEMESIS_MIN_PICKS,
    },
    prompts: {
      claimStreak:
        user.kind === "ghost" && (stats?.participationStreak ?? 0) >= CONSTANTS.CLAIM_PROMPT_STREAK,
      claimPicks: user.kind === "ghost" && picksResolvedTotal >= CONSTANTS.CLAIM_PROMPT_PICKS,
    },
  };
}

export interface MePickRow {
  id: string;
  questionId: string;
  side: "yes" | "no";
  entryPrice: string;
  entryPriceAt: Date;
  pickedAt: Date;
  result: "pending" | "win" | "loss" | "void";
}

/**
 * §5.6: the picker waits for the reveal ceremony too — result hidden
 * until revealed. `id` is included beyond the doc's literal field list
 * because the share-card flow (§7.8) needs a stable pick identifier to
 * build /api/cards/daily/{pickId} — not third-party data, so it doesn't
 * touch INV-6.
 */
export function mePick(p: MePickRow, questionStatus: QuestionStatus) {
  return {
    id: p.id,
    questionId: p.questionId,
    side: p.side,
    entryPrice: Number(p.entryPrice),
    entryPriceAt: p.entryPriceAt.toISOString(),
    pickedAt: p.pickedAt.toISOString(),
    result: questionStatus === "revealed" ? p.result : null,
  };
}
