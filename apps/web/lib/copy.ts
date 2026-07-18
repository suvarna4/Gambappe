/**
 * Single source of every user-facing string (design doc §10.6: "Every user-facing string
 * lives in `apps/web/lib/copy.ts` (single reviewable file; no scattered literals) including
 * narration templates' rendered strings (§13.3)." — WS14-T3 scans this file for money words).
 *
 * This file is created by WS7-T5 (the first UI task that needs claim-prompt copy); later tasks
 * should add their own strings here rather than starting a second copy file.
 *
 * Rules enforced in review (§10.6):
 *  - No money amounts, "bets", stake sizes, or venue balances (INV-8) — say "pick"/"call".
 *  - Mechanic names are plain words (P11): nemesis, duo, streak, freeze, receipt, called it.
 *  - The two claim-nudge strings and the publicness sentence below are PINNED VERBATIM —
 *    do not paraphrase them (§11.3, §13.3 both point back at this file for the rendered text).
 */

/** INV-6, pinned verbatim (§10.6): shown on the claim/signup screen. */
export const CLAIM_PUBLICNESS_STATEMENT =
  'Your picks, results, and rating are public — that\'s the point. You can stay pseudonymous forever.';

/**
 * §11.3 claim-prompt triggers: streak reaching 3, 5th pick, viewing a nemesis/duo surface as a
 * ghost. §10.6 pins exactly two nudge strings (streak, fingerprint) for those three triggers.
 * `NEMESIS_MIN_PICKS` (packages/core/src/config.ts) is 5 — the same number as the "5th pick"
 * trigger — so reaching the 5th pick *is* reaching nemesis-fingerprint eligibility. The 5th-pick
 * trigger and the nemesis/duo-surface trigger are therefore both instances of "your fingerprint
 * is ready" and share the fingerprint copy; only the streak trigger gets its own pinned string.
 * SPEC-GAP(WS7-T5): §10.6 doesn't say this explicitly — flagging in case a future edit adds a
 * dedicated 5th-pick string.
 */
export const CLAIM_NUDGE_COPY = {
  streak: 'Your ghost has a 3-day streak. Claim it before this device loses it.',
  fingerprint: 'Your fingerprint is ready. Claim your record to get assigned your nemesis.',
} as const;

export type ClaimNudgeTrigger = keyof typeof CLAIM_NUDGE_COPY;

export const CLAIM_PROMPT_CTA = 'Claim your account';
export const CLAIM_PROMPT_DISMISS_LABEL = 'Not now';

/**
 * Shared-device guard (§6.3): "You're claiming **{handle}** — {streak}-day streak, {picks}
 * picks. That you?" — the design doc gives this as an illustrative example inside §6.3's prose,
 * not a §10.6-pinned string, so it's implemented as a template here rather than copied verbatim.
 */
export function ghostConfirmationCopy(handle: string, streak: number, gradedPicks: number): string {
  const streakPart = streak > 0 ? `${streak}-day streak` : 'no streak yet';
  const picksPart = gradedPicks === 1 ? '1 pick' : `${gradedPicks} picks`;
  return `You're claiming ${handle} — ${streakPart}, ${picksPart}. That you?`;
}

export const CLAIM_CONFIRM_YES_LABEL = 'That\'s me — continue';
export const CLAIM_CONFIRM_NOT_ME_LABEL = 'This isn\'t me';

export const CLAIM_SIGNIN_HEADING = 'Claim your account';
export const CLAIM_SIGNIN_GOOGLE_LABEL = 'Continue with Google';
export const CLAIM_SIGNIN_X_LABEL = 'Continue with X';
export const CLAIM_SIGNIN_EMAIL_LABEL = 'Continue with email';
export const CLAIM_SIGNIN_EMAIL_PLACEHOLDER = 'you@example.com';
export const CLAIM_SIGNIN_EMAIL_SUBMIT_LABEL = 'Send me a link';
export const CLAIM_SIGNIN_EMAIL_SENT =
  'Check your email for a sign-in link. You can close this and come back once you\'ve clicked it.';

/** INV-9 (§6.2 step 0 wording: "an explicit 'I'm 18+' confirm"). */
export const CLAIM_AGE_ATTEST_HEADING = 'One more thing';
export const CLAIM_AGE_ATTEST_LABEL = "I'm 18 or older";
export const CLAIM_AGE_ATTEST_SUBMIT_LABEL = 'Confirm & claim';
export const CLAIM_AGE_ATTEST_FOOTNOTE = 'Receipts never holds money — picks are for competition, not wagers.';

export const CLAIM_SUCCESS_HEADING = "You're claimed";
export const CLAIM_SUCCESS_CASE_B_CTA = 'Answer a few quick questions to get placed';
export const CLAIM_ALREADY_CLAIMED = 'This account is already claimed. Nothing to do here.';
export const CLAIM_GENERIC_ERROR = 'Something went wrong claiming your account. Try again.';

export const EIGHTEEN_PLUS_FOOTER_NOTICE =
  '18+ only. Receipts never holds money — picks are for competition, not wagers.';
