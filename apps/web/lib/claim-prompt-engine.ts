/**
 * Claim prompt engine (design doc §11.3, WS7-T5): pure trigger-evaluation logic, kept free of
 * React/DOM so it's directly unit-testable (mirrors the `claim-flow.ts`/`route.ts` split — the
 * `ClaimPromptEngine` component is a thin adapter around this).
 *
 * Triggers (§11.3, exact wording): "streak reaching 3, 5th pick, viewing a nemesis/duo surface
 * as ghost". Only ever fires for a ghost (never a claimed profile — a claimed user has nothing
 * left to claim). Dismissible; re-prompts at most 1/day (localStorage marker); never blocks the
 * pick loop (this module never prevents any other action — it only decides whether to render a
 * dismissible nudge).
 *
 * `NEMESIS_MIN_PICKS` (packages/core/src/config.ts) is 5 — the same threshold as "5th pick" —
 * so reaching the 5th pick and being fingerprint/nemesis-eligible are the same event. Both that
 * trigger and "viewing a nemesis/duo surface as ghost" use the `fingerprint` copy (§10.6 only
 * pins two nudge strings for three trigger conditions; see copy.ts for the full note).
 */
import { NEMESIS_MIN_PICKS } from '@receipts/core';
import type { ClaimNudgeTrigger } from './copy';

export const CLAIM_PROMPT_STORAGE_KEY = 'rcpt_claim_prompt_last_shown';
/** §11.3: streak reaching 3. */
export const CLAIM_PROMPT_STREAK_THRESHOLD = 3;
/** §11.3: 5th pick — equal to `NEMESIS_MIN_PICKS` (see module doc above). */
export const CLAIM_PROMPT_PICK_THRESHOLD = NEMESIS_MIN_PICKS;

export interface ClaimPromptInput {
  /** Never triggers for a claimed profile or a fully anonymous visitor — ghosts only. */
  isGhost: boolean;
  streakCurrent: number;
  pickCount: number;
  viewingNemesisOrDuoSurfaceAsGhost: boolean;
  /**
   * WS21-T2 (journeys plan §5, D-J5/D-J8): the ghost is looking at a PENDING incoming call-out they
   * must Save before they can accept (`IncomingCalloutCard`, WS20-T4). Time-boxed (24h expiry) and
   * a strong "get your nemesis" hook, so it shares the `fingerprint` nudge copy — "Save your record
   * to get your nemesis" is exactly what accepting a call-out does. Optional so existing callers and
   * fixtures (which predate this trigger) stay valid.
   */
  incomingCallout?: boolean;
}

/**
 * Which trigger condition is currently satisfied, if any — independent of the once-a-day cap
 * (that's applied separately by `canShowToday`, since "the condition is true" and "we're allowed
 * to show it today" are different questions with different testable behavior).
 *
 * Priority when multiple conditions hold at once: the streak trigger fires first — it's a loss-
 * aversion message ("before this device loses it") tied to a countdown-like resource, more
 * time-sensitive than fingerprint readiness, which stays true indefinitely once reached.
 */
export function determineClaimPromptTrigger(input: ClaimPromptInput): ClaimNudgeTrigger | null {
  if (!input.isGhost) return null;
  if (input.streakCurrent >= CLAIM_PROMPT_STREAK_THRESHOLD) return 'streak';
  // WS21-T2: a pending incoming call-out is time-boxed, so it ranks above the always-true
  // fingerprint-readiness conditions below; it uses the same `fingerprint` copy ("…to get your
  // nemesis"), which is exactly what accepting the call-out grants.
  if (input.incomingCallout) return 'fingerprint';
  if (input.pickCount >= CLAIM_PROMPT_PICK_THRESHOLD) return 'fingerprint';
  if (input.viewingNemesisOrDuoSurfaceAsGhost) return 'fingerprint';
  return null;
}

/** YYYY-MM-DD in the visitor's local time zone — the unit the 1/day cap is measured in. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Pure: given the localStorage marker's current value, may the prompt show today? */
export function canShowToday(lastShownKey: string | null, now: Date = new Date()): boolean {
  return lastShownKey !== todayKey(now);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // Storage can throw in locked-down contexts (private browsing quirks, disabled storage).
    // Same posture as the ghost cookie parser: never throw, just behave as if unavailable.
    return null;
  }
}

export function getLastShownKey(storage: StorageLike | null = safeStorage()): string | null {
  return storage?.getItem(CLAIM_PROMPT_STORAGE_KEY) ?? null;
}

export function markShownToday(now: Date = new Date(), storage: StorageLike | null = safeStorage()): void {
  storage?.setItem(CLAIM_PROMPT_STORAGE_KEY, todayKey(now));
}

/**
 * Full decision in one call: is there a trigger AND are we allowed to show it today? Does not
 * itself mark anything shown — the caller marks it once it has actually rendered the nudge
 * (`markShownToday`), so a component that decides not to render for some other reason (e.g.
 * still loading) doesn't burn the day's single slot.
 */
export function evaluateClaimPrompt(
  input: ClaimPromptInput,
  now: Date = new Date(),
  storage: StorageLike | null = safeStorage(),
): ClaimNudgeTrigger | null {
  const trigger = determineClaimPromptTrigger(input);
  if (!trigger) return null;
  return canShowToday(getLastShownKey(storage), now) ? trigger : null;
}
