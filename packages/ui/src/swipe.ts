/**
 * SW0-T2 · Swipe-ballot interaction constants (swipe-ux-plan §2.3, §2.7, §2.8).
 *
 * Presentation constants only — deliberately in `packages/ui`, NOT `packages/core`, so tuning
 * the feel never needs a contract-change PR. `SwipeBallot` (SW1-T2), the deck shell (SW2-T1),
 * the receipt slip (SW1-T3), and the obituary card (SW4-T1) all read these so the numbers in
 * the plan live in exactly one place.
 */

/** Commit fires once horizontal drag passes this fraction of the card's width. */
export const COMMIT_THRESHOLD_RATIO = 0.36;
/** Rotation is clamped to ±this many degrees while dragging. */
export const MAX_TILT_DEG = 12;
/** Rotation applied per pixel of horizontal drag, before the ±`MAX_TILT_DEG` clamp. */
export const TILT_DEG_PER_PX = 0.09;
/** Vertical follow is damped by this factor (the card mostly tracks x, barely y). */
export const DRAG_Y_FACTOR = 0.25;
/** Stamp-preview scale at zero progress; eases to 1.0 as progress → 1 (1.4 → 1.0). */
export const STAMP_SCALE_FROM = 1.4;

/** Early-release spring-back (progress < 1): duration + easing. */
export const SNAP_MS = 400;
export const SNAP_EASE = 'cubic-bezier(.28,1.6,.5,1)';
/** Commit exit fling: duration + easing. */
export const FLING_MS = 300;
export const FLING_EASE = 'cubic-bezier(.3,.6,.4,1)';
/** Receipt slip print/retract: duration + easing. */
export const PRINT_MS = 420;
export const PRINT_EASE = 'cubic-bezier(.22,1,.36,1)';

/**
 * `navigator.vibrate` argument for each moment (ms, or a pattern array). A no-op where the
 * API is absent — never gate behavior on it. Arm = one light tick as the card crosses the
 * threshold; commit = a firmer three-pulse thunk; undo = a soft tick.
 */
export const HAPTIC_ARM = 8;
export const HAPTIC_COMMIT = [12, 40, 18] as const;
export const HAPTIC_UNDO = 6;

/** Idle-nudge (D-SW7): delay before the discoverability sway plays, and its CSS animation. */
export const NUDGE_IDLE_MS = 3800;
export const NUDGE_ANIM = '2.6s ease-in-out';

/** A busted streak mints an obituary artifact (SW4-T1) only if the broken run was at least
 * this long — a one- or two-day run isn't a story worth a tombstone. */
export const OBITUARY_MIN_STREAK = 3;

// ---------------------------------------------------------------------------------------------
// Pure gesture math (SW1-T2). Extracted so the interaction can be unit-tested with no DOM — the
// repo's vitest runs in `node` (no jsdom), and pointer-drag behavior is covered end-to-end by
// the SW1-T5 Playwright suite in a real browser. `SwipeBallot` wires these to Pointer Events.
// ---------------------------------------------------------------------------------------------

import type { MarketSide } from './format.js';

/** Which side a horizontal drag points at: right (dx > 0) = YES/for, left = NO/against (D-SW9). */
export function dragSide(dx: number): MarketSide {
  return dx > 0 ? 'yes' : 'no';
}

/**
 * Progress toward commit as a fraction of the threshold: `|dx| / (width × COMMIT_THRESHOLD_RATIO)`.
 * `0` at rest, `1` exactly at the commit threshold, `>1` past it. Guards a zero/unknown width
 * (returns 0) so an unmeasured card can't spuriously commit.
 */
export function dragProgress(dx: number, cardWidth: number): number {
  if (!(cardWidth > 0)) return 0;
  return Math.abs(dx) / (cardWidth * COMMIT_THRESHOLD_RATIO);
}

/** A release commits once progress reaches the threshold (progress ≥ 1). */
export function isCommit(progress: number): boolean {
  return progress >= 1;
}

/** Card rotation for a drag: `dx × TILT_DEG_PER_PX`, clamped to ±`MAX_TILT_DEG`. */
export function tiltDeg(dx: number): number {
  return Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, dx * TILT_DEG_PER_PX));
}

/** Stamp-preview scale: `STAMP_SCALE_FROM` at zero progress, easing to 1.0 at/after the threshold. */
export function stampScale(progress: number): number {
  return STAMP_SCALE_FROM - (STAMP_SCALE_FROM - 1) * Math.min(1, Math.max(0, progress));
}

/** World-tint / stamp-preview opacity: ramps 0 → 0.85 with progress, capped at the threshold. */
export function tintOpacity(progress: number): number {
  return 0.85 * Math.min(1, Math.max(0, progress));
}

// ---- Guardrail logic (D-SW7). Pure; the component owns the actual localStorage/sessionStorage.

/** localStorage / sessionStorage keys for the first-throw + once-per-session idle-nudge guards
 * (§2.8). The old per-device `picks` counter that faded the rails/hint arrows was removed with the
 * rails themselves — the single instruction line never fades. */
export const GUARDRAIL_KEYS = {
  thrown: 'rcpt_thrown',
  nudged: 'rcpt_nudged',
} as const;

/**
 * Whether the idle nudge should play: only on an open question the viewer can act on, only
 * before their first-ever throw, and only once per session. Pure decision from the three
 * stored flags so the timer effect stays trivial.
 */
export function shouldNudge(opts: {
  isOpen: boolean;
  hasThrownEver: boolean;
  nudgedThisSession: boolean;
}): boolean {
  return opts.isOpen && !opts.hasThrownEver && !opts.nudgedThisSession;
}
