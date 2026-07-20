/**
 * `QuestionRow` (+ its `MarketRow`) → the public `questionPublicSchema` shape (§9.2, §9.3, §5.7
 * effective-state rule). Two things read-side derivation has to get right:
 *
 *  1. **Effective status** is derived from timestamps, not the raw column — a question whose
 *     `lock_at` has passed presents as `locked` even if `question:lock` hasn't run yet
 *     (worker-outage tolerance, §5.7). `revealed`/`voided` are real gates, never inferred.
 *  2. **Crowd split is null while `open` (effective), with no exceptions** (§9.3) — and even
 *     once effectively locked, it's null until the real lock snapshot exists (a late lock job
 *     "back-fills" it; there's nothing dishonest about returning null in the meantime).
 */
import { ApiError, type QuestionPeek, type QuestionStatus, type QuestionPublic } from '@receipts/core';
import type { MarketRow, QuestionRow } from '@receipts/db';

/** State-machine order (§5.7: draft → scheduled → open → locked → revealed) — used to keep
 * the timestamp derivation below monotonic-forward-only. `revealed`/`voided` aren't in here;
 * they're terminal and returned immediately, never reached by the ranking logic. */
const STATUS_RANK: Partial<Record<QuestionStatus, number>> = {
  draft: 0,
  scheduled: 1,
  open: 2,
  locked: 3,
};

/**
 * §5.7 effective-state rule. `revealed`/`voided` are terminal and never overridden. `draft` is
 * pre-publication and never derived forward from timestamps — a draft with stale/unset dates
 * must never present as `open`/`locked` (callers should also outright refuse to serve a raw
 * `draft` question at all; see `assertQuestionPubliclyVisible`). For everything else, the
 * derivation is monotonic: it only ever moves a question LATER than its raw status (the
 * documented worker-outage tolerance — `lock_at` passed but `question:lock` hasn't run yet)
 * and never earlier (an admin early-lock with a future `lock_at` must stay `locked`, not
 * reappear as `open` just because the clock hasn't caught up to it).
 */
export function effectiveQuestionStatus(question: QuestionRow, at: Date): QuestionStatus {
  if (question.status === 'revealed' || question.status === 'voided') return question.status;
  if (question.status === 'draft') return 'draft';

  const timestampDerived: QuestionStatus =
    at.getTime() >= question.lockAt.getTime()
      ? 'locked'
      : at.getTime() >= question.openAt.getTime()
        ? 'open'
        : 'scheduled';

  const rawRank = STATUS_RANK[question.status] ?? 0;
  const derivedRank = STATUS_RANK[timestampDerived] ?? 0;
  return derivedRank > rawRank ? timestampDerived : question.status;
}

/** Draft questions are pre-publication — never served on a public read route (§5.7). */
export function assertQuestionPubliclyVisible(question: Pick<QuestionRow, 'status'>): void {
  if (question.status === 'draft') {
    throw new ApiError('NOT_FOUND', 'no such question');
  }
}

export function serializeQuestionPublic(question: QuestionRow, market: MarketRow, at: Date): QuestionPublic {
  if (!question.slug) throw new Error(`serializeQuestionPublic: question ${question.id} has no slug`);

  const status = effectiveQuestionStatus(question, at);
  const showCrowd = status !== 'open' && status !== 'scheduled' && status !== 'draft';
  const crowd =
    showCrowd && question.crowdYesAtLock !== null && question.crowdNoAtLock !== null
      ? {
          yes: question.crowdYesAtLock,
          no: question.crowdNoAtLock,
          // Rounded at the serialization boundary: every display of this value (§10.1's own
          // "The crowd said 63%" archetype, og:description, JSON-LD, the /q archive) is an
          // integer percent — an unrounded 2/3 here surfaced as "66.66666666666666%" in meta
          // tags. Majority questions must compare the raw COUNTS, never this rounded value
          // (49.6 rounds to 50 and would flip sides).
          pct_yes:
            question.crowdYesAtLock + question.crowdNoAtLock === 0
              ? 0
              : Math.round(
                  (question.crowdYesAtLock / (question.crowdYesAtLock + question.crowdNoAtLock)) * 100,
                ),
        }
      : null;

  return {
    id: question.id as QuestionPublic['id'],
    slug: question.slug,
    kind: question.kind,
    status,
    question_date: question.questionDate,
    headline: question.headline,
    blurb: question.blurb,
    yes_label: question.yesLabel,
    no_label: question.noLabel,
    open_at: question.openAt.toISOString(),
    lock_at: question.lockAt.toISOString(),
    reveal_at: question.revealAt.toISOString(),
    yes_price: market.yesPrice,
    yes_price_updated_at: market.yesPriceUpdatedAt ? market.yesPriceUpdatedAt.toISOString() : null,
    crowd,
    // Publication rule (§6.5/§6.7): outcome is a real gate on the RAW status, never inferred.
    outcome: question.status === 'revealed' ? question.outcome : null,
    revealed_at: question.status === 'revealed' ? question.revealedAt!.toISOString() : null,
    void_reason: question.voidReason,
    is_volatile: question.isVolatile,
    venue: market.venue,
    venue_url: market.venueUrl,
  };
}

/**
 * `QuestionRow` → the `GET /questions/tomorrow` peek shape (design-diff audit, §9.2
 * contract-change), or `null` when there's nothing safe to peek at. Pure — no market row needed,
 * because (per `questionPeekSchema`'s doc comment) the peek never carries anything derived from
 * the market at all.
 *
 * Reuses this file's own masking primitives rather than reinventing them: `effectiveQuestionStatus`
 * for the §5.7 timestamp-derived state, and the same draft-rejection `assertQuestionPubliclyVisible`
 * already enforces for every other public read path. Returns `null` (never throws) for every
 * disqualifying case — a `draft` row, or a row whose effective status has already moved past
 * `scheduled` (already open/locked/revealed/voided "tomorrow" isn't "tomorrow, unopened" anymore,
 * and this endpoint has no shape for that) — so the caller can uniformly treat "nothing to peek
 * at" as a 404 without a second layer of status branching.
 */
export function serializeQuestionPeek(question: QuestionRow, at: Date): QuestionPeek | null {
  if (question.status === 'draft') return null;
  const status = effectiveQuestionStatus(question, at);
  if (status !== 'scheduled') return null;
  return {
    status: 'scheduled',
    open_at: question.openAt.toISOString(),
  };
}
