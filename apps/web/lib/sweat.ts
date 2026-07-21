/**
 * WS19-T2 · Pure presentation logic for the Sweat room (`docs/journeys-plan.md` §5, D-J3): the
 * settle-when label and the held-side price drift. Kept separate from the DB assembly
 * (`sweat-feed.ts`) and the React row (`components/SweatRow.tsx`) so the deterministic maths has
 * unit coverage without a Postgres or a DOM in the loop — every function here is a pure function
 * of its arguments (no wall-clock reads: the caller passes `nowMsValue`, the same
 * `@receipts/core` clock the rest of the SSR path uses).
 *
 * No money words anywhere (INV-8): drift is quoted in implied-probability cents ("¢"), never a
 * dollar amount or a stake.
 */
import { DISPLAY_TZ } from '@receipts/core';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** The settle-when label kinds (soonest → farthest). `live` sorts before `weekday` before
 * `month`; within a kind the raw close instant breaks ties (see `sweat-feed.ts`). */
export type SettleWhenKind = 'live' | 'weekday' | 'month';

export interface SettleWhen {
  kind: SettleWhenKind;
  /** The rendered label: `LIVE`, a short weekday (`THU`), or `~JUL 2026`. */
  text: string;
}

/**
 * D-J3 settle-when label from a market's close instant, relative to `nowMsValue`:
 *   - within 2h (or already past — a pending pick whose market has closed is settling now) → `LIVE`
 *   - within 7 days → the short uppercase weekday in the display zone (`THU`)
 *   - otherwise → an approximate `~MON YYYY` (month abbreviation + year), the "no exact date yet"
 *     framing for a far-off venue resolution.
 *
 * The `~MON YYYY` far label deliberately carries the `~` and the year so its month abbreviation
 * can't be misread as the weekday abbreviation the <7d case prints (both are three uppercase
 * letters).
 */
export function settleWhenLabel(closeIso: string, nowMsValue: number): SettleWhen {
  const closeMs = Date.parse(closeIso);
  const delta = closeMs - nowMsValue;
  if (delta < TWO_HOURS_MS) return { kind: 'live', text: 'LIVE' };
  if (delta < SEVEN_DAYS_MS) {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: DISPLAY_TZ,
      weekday: 'short',
    })
      .format(new Date(closeMs))
      .toUpperCase();
    return { kind: 'weekday', text: weekday };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TZ,
    month: 'short',
    year: 'numeric',
  }).formatToParts(new Date(closeMs));
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').toUpperCase();
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  return { kind: 'month', text: `~${month} ${year}` };
}

/** Ordinal for soonest-first sorting: LIVE first, then weekday, then month. */
export const SETTLE_WHEN_ORDER: Record<SettleWhenKind, number> = {
  live: 0,
  weekday: 1,
  month: 2,
};

/**
 * The implied probability (in integer cents) of the side the viewer actually holds, given the
 * raw YES price. `yesPriceAtEntry`/`market.yesPrice` are stored as the YES price regardless of
 * side (§5.3); the held side's implied cost is `yes` for a YES pick, `1 − yes` for a NO pick —
 * the same derivation `reveal-payload.ts`'s `impliedEntryCents` and the engine's fingerprint use.
 */
export function impliedHeldCents(side: 'yes' | 'no', yesPrice: number): number {
  return Math.round((side === 'yes' ? yesPrice : 1 - yesPrice) * 100);
}

export interface HeldDrift {
  /** Signed cents the held side has moved since entry; null when no live price is available. */
  cents: number | null;
  /** `up` = the held side got more likely (winning direction), `down` = less likely, `flat` = 0. */
  direction: 'up' | 'down' | 'flat' | 'unknown';
}

/**
 * Price drift of the held side since entry: `now − entry` in implied-probability cents. Positive
 * (the held side got more likely) reads as the winning direction; negative as the losing one —
 * this is what the row colours win/loss (D-J3: "drift `now yes_price − entry` coloured
 * win/loss"). A null live price (venue price not yet populated) yields `unknown`, rendered
 * neutrally rather than as a false 0.
 */
export function heldSideDrift(
  side: 'yes' | 'no',
  yesPriceAtEntry: number,
  yesPriceNow: number | null,
): HeldDrift {
  if (yesPriceNow === null) return { cents: null, direction: 'unknown' };
  const cents = impliedHeldCents(side, yesPriceNow) - impliedHeldCents(side, yesPriceAtEntry);
  const direction = cents > 0 ? 'up' : cents < 0 ? 'down' : 'flat';
  return { cents, direction };
}
