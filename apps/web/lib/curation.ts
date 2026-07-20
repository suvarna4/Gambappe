/**
 * Curation tooling (design doc §15.2, WS10-T2): question composer defaults + validations.
 * "All ET-anchored scheduling computes instants via the IANA zone America/New_York
 * (DST-correct); never hardcode UTC offsets" (§4.3) — `zonedTimeToUtc` is the one place
 * that conversion happens for this task.
 */
import { z } from 'zod';
import type { QuestionPublic } from '@receipts/core';
import {
  DAILY_LOCK_LOCAL,
  DAILY_OPEN_LOCAL,
  DAILY_REVEAL_LOCAL,
  SCHEDULE_TZ,
  etDateString,
  now,
  slugifyHandle,
} from '@receipts/core';

/**
 * Composer input shape — shared between the API route and (eventually) the admin UI form,
 * matching the doc's general "one schema, both sides validate against it" philosophy even
 * though admin surfaces aren't part of the public §9.2 contract in packages/core.
 */
export const composerBodySchema = z
  .object({
    market_id: z.string().uuid(),
    headline: z.string().min(1).max(200),
    blurb: z.string().max(500).nullable().optional(),
    yes_label: z.string().min(1).max(50),
    no_label: z.string().min(1).max(50),
    question_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    open_at: z.string().datetime({ offset: true }).optional(),
    lock_at: z.string().datetime({ offset: true }).optional(),
    reveal_at: z.string().datetime({ offset: true }).optional(),
    is_volatile: z.boolean().optional(),
    event_start_at: z.string().datetime({ offset: true }).nullable().optional(),
    paired_market_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export type ComposerBody = z.infer<typeof composerBodySchema>;

/** e.g. `2026-07-19-world-cup-final` (§5.3 slug format), reusing the generic slugifier. */
export function buildQuestionSlug(questionDate: string, headline: string): string {
  return `${questionDate}-${slugifyHandle(headline)}`;
}

/** Offset (minutes, UTC − zoned) of `timeZone` at the instant `date` represents. */
function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * The wall-clock time `HH:MM` on `dateStr` (YYYY-MM-DD) in `timeZone`, as a UTC instant.
 * DST-correct: computes the zone's actual offset at that instant rather than assuming a
 * fixed one. (One correction pass — accurate except in the literal hour of a DST
 * transition, same caveat any single-pass zoned-time conversion has.)
 */
export function zonedTimeToUtc(dateStr: string, hhmm: string, timeZone: string): Date {
  const [hour, minute] = hhmm.split(':').map(Number);
  const naiveUtc = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
  const offsetMinutes = timeZoneOffsetMinutes(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60_000);
}

export interface DefaultQuestionTimes {
  openAt: Date;
  lockAt: Date;
  revealAt: Date;
}

/** Defaults per §15.2, read from Appendix D: open 03:00 (midnight PT, WS15-T7) / lock 12:00 / reveal 20:00 ET. */
export function computeDefaultQuestionTimes(questionDate: string): DefaultQuestionTimes {
  return {
    openAt: zonedTimeToUtc(questionDate, DAILY_OPEN_LOCAL, SCHEDULE_TZ),
    lockAt: zonedTimeToUtc(questionDate, DAILY_LOCK_LOCAL, SCHEDULE_TZ),
    revealAt: zonedTimeToUtc(questionDate, DAILY_REVEAL_LOCAL, SCHEDULE_TZ),
  };
}

const RESOLVE_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface ComposerMarketInput {
  category: string;
  closeTime: Date;
  expectedResolveTime: Date | null;
}

export interface ComposerTimesInput {
  openAt: Date;
  lockAt: Date;
  revealAt: Date;
  eventStartAt: Date | null;
}

/** Explicit times win; otherwise fall back to the §15.2 03:00/12:00/20:00 ET defaults (open = midnight PT, WS15-T7). */
export function resolveComposerTimes(body: ComposerBody): ComposerTimesInput {
  const defaults = computeDefaultQuestionTimes(body.question_date);
  return {
    openAt: body.open_at ? new Date(body.open_at) : defaults.openAt,
    lockAt: body.lock_at ? new Date(body.lock_at) : defaults.lockAt,
    revealAt: body.reveal_at ? new Date(body.reveal_at) : defaults.revealAt,
    eventStartAt: body.event_start_at ? new Date(body.event_start_at) : null,
  };
}

/**
 * §15.2 validations, pure (no DB access — the one-daily-per-date check needs a query and
 * lives in the route handler, backstopped by the DB's own partial unique index regardless).
 */
export function validateComposerInput(
  market: ComposerMarketInput,
  times: ComposerTimesInput,
  at: Date = now(),
): string[] {
  const errors: string[] = [];

  // WS15-T6 guardrail: a lock_at already in the past means a stillborn question — every
  // lifecycle job fires immediately and the ET-keyed today lookup will likely never show it.
  // The usual cause is a curator whose LOCAL date lags the ET product day (staging hit this
  // at 2 AM ET: question_date set to "yesterday"). A past open_at alone stays legal — that's
  // the normal compose-today's-question-late flow (it just opens immediately).
  if (times.lockAt.getTime() <= at.getTime()) {
    errors.push(
      `lock_at is already in the past — the product day runs on ET; did you mean question_date ${etDateString(at)}?`,
    );
  }

  if (market.closeTime.getTime() < times.lockAt.getTime()) {
    errors.push('market close_time must be at or after lock_at');
  }

  if (
    market.expectedResolveTime &&
    market.expectedResolveTime.getTime() - times.lockAt.getTime() > RESOLVE_WINDOW_MS
  ) {
    errors.push('expected resolution must be within 48h of lock_at');
  }

  if (times.eventStartAt && times.lockAt.getTime() > times.eventStartAt.getTime()) {
    errors.push('lock_at must be at or before event_start_at (no in-play entry, §6.2)');
  }

  if (market.category === 'sports' && !times.eventStartAt) {
    errors.push('event_start_at is required for sports/live-event markets');
  }

  return errors;
}

export interface PreviewMarket {
  venue: string;
  venueUrl: string;
  yesPrice: number | null;
  yesPriceUpdatedAt: Date | null;
}

/**
 * The `questionPublicSchema` shape the eventual spectator page will render (§10.1/§9.2) —
 * built here, before persistence, so "preview matches spectator render" (§15.2 AC) is
 * checkable at the data-contract level even though WS7-T2's page doesn't exist yet.
 * `id` is a fresh, non-persisted uuid — regenerated on every preview call.
 */
export function buildQuestionPreview(
  id: string,
  slug: string,
  body: ComposerBody,
  times: ComposerTimesInput,
  market: PreviewMarket,
): QuestionPublic {
  return {
    id: id as QuestionPublic['id'],
    slug,
    kind: 'daily',
    status: 'scheduled',
    question_date: body.question_date,
    headline: body.headline,
    blurb: body.blurb ?? null,
    yes_label: body.yes_label,
    no_label: body.no_label,
    open_at: times.openAt.toISOString(),
    lock_at: times.lockAt.toISOString(),
    reveal_at: times.revealAt.toISOString(),
    yes_price: market.yesPrice,
    yes_price_updated_at: market.yesPriceUpdatedAt ? market.yesPriceUpdatedAt.toISOString() : null,
    crowd: null, // never public before lock (§9.3) — a scheduled/draft question has none yet
    outcome: null,
    revealed_at: null,
    void_reason: null,
    is_volatile: body.is_volatile ?? false,
    venue: market.venue as QuestionPublic['venue'],
    venue_url: market.venueUrl,
  };
}
