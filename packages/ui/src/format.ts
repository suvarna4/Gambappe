export type MarketSide = 'yes' | 'no';

/** §10.4 PriceTag: side price in cents, rounded — "YES @ 63¢" is cents-of-probability, never money. */
export function impliedCents(side: MarketSide, yesProbability: number): number {
  const sidePrice = side === 'yes' ? yesProbability : 1 - yesProbability;
  return Math.round(Math.min(1, Math.max(0, sidePrice)) * 100);
}

export interface CountdownParts {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  const totalMs = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { totalMs, days, hours, minutes, seconds, expired: totalMs === 0 };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** "2d 04h" beyond a day, else "1:04:03" — mono-formatted, matches §10.3 countdown-to-lock/reveal. */
export function formatCountdown(parts: CountdownParts): string {
  if (parts.expired) return '0:00';
  if (parts.days > 0) return `${parts.days}d ${pad2(parts.hours)}h`;
  if (parts.hours > 0) return `${parts.hours}:${pad2(parts.minutes)}:${pad2(parts.seconds)}`;
  return `${parts.minutes}:${pad2(parts.seconds)}`;
}

export interface CrowdSplit {
  yesPct: number;
  noPct: number;
}

/** §10.3 crowd split — even 50/50 when nobody has picked yet, rather than NaN. */
export function crowdSplit(yesCount: number, noCount: number): CrowdSplit {
  const total = yesCount + noCount;
  if (total === 0) return { yesPct: 50, noPct: 50 };
  const yesPct = Math.round((yesCount / total) * 100);
  return { yesPct, noPct: 100 - yesPct };
}

/** §2.6 F1 hush: how long before `reveal_at` the pre-reveal hush (frozen chip, stage dim, room
 * count) activates. */
export const HUSH_WINDOW_MS = 10_000;

/** True from `HUSH_WINDOW_MS` before `targetMs` up to (not including) `targetMs` itself. This is
 * the trigger window, not the display window: a caller that latches "hushed" on the first true
 * result (to avoid flapping) may keep showing it briefly past `targetMs` too, until it stops
 * polling for the state that supersedes it. */
export function isHushWindow(targetMs: number, nowMs: number, windowMs = HUSH_WINDOW_MS): boolean {
  const remaining = targetMs - nowMs;
  return remaining > 0 && remaining <= windowMs;
}

const BAR_HEIGHTS = [3, 5, 7, 9] as const;

/** Deterministic decorative bar widths for the §10.4 Barcode motif — not a scannable code. */
export function barcodePattern(path: string, barCount = 40): number[] {
  const bars: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const ch = path.charCodeAt(i % path.length) || 0;
    const idx = (ch + i * 7) % BAR_HEIGHTS.length;
    bars.push(BAR_HEIGHTS[idx]!);
  }
  return bars;
}
