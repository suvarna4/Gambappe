/**
 * Single source of every user-facing string (design doc §10.6: "Every user-facing string
 * lives in `apps/web/lib/copy.ts` (single reviewable file; no scattered literals) including
 * narration templates' rendered strings (§13.3)." — WS14-T3 scans this file for money words).
 *
 * Seeded independently by WS7-T2 (the `copy.question`/`copy.errors` sections), WS7-T5 (the
 * flat `CLAIM_*` exports, claim flow UI), WS7-T6 (`nemesisCopy`, nemesis UI), and WS7-T10
 * (`copy.placement`) before any had landed on `main` — merged here on rebase. Later tasks
 * should add their own section to this file rather than starting a second copy file.
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

/** WS7-T2 (home + question page) section. */
export const copy = {
  question: {
    /** `scheduled` state (§10.3): headline shown with an "opens" countdown, no CTA at P0 —
     * the table's "notify-me (claimed)" CTA is claim-gated, and claiming is P1 (§19.5: "Public
     * users are ghosts-only at P0"). */
    opensLabel: 'Opens',
    /** `open` state: countdown to lock. */
    locksInLabel: 'Locks in',
    /** `locked` state: countdown to reveal. */
    revealInLabel: 'Reveal in',
    /** §9.3: the exact phrase both API and pages use pre-lock instead of a live crowd split. */
    crowdLocksAt: (time: string) => `Crowd locks in at ${time}`,
    pickPrompt: 'Pick your side',
    /** DD-11/INV-9: the second tap of the two-tap first-pick flow. */
    ageGatePrompt: "You'll need to confirm you're 18+ to place your first pick.",
    ageGateConfirm: "I'm 18+ — pick it",
    ageGateCancel: 'Not yet',
    receiptConfirmedTitle: 'Receipt stamped.',
    comeBackAt: (time: string) => `Come back at ${time} for the reveal.`,
    addToCalendar: 'Add reveal to calendar',
    undoButton: 'Undo pick',
    undoExpired: 'Undo window closed — your pick stands.',
    yourPickLabel: 'Your pick',
    crowdSaysLabel: 'The crowd says',
    voidedExplainer:
      "Voided by the venue — this one's streak-safe, it won't count for or against you.",
    revealedNoPickLabel: "You didn't pick this one.",
    calledItBadge: 'Called it',
    /** WS7-T3 reveal sequence (§10.3): the percentile/streak count-up block. `topPercent` is
     * already the §8.6 "Top X%" convention (100 − percentile, clamped to a 1% floor) — see
     * `@receipts/core`'s `topPercentDisplay`, the same helper `/p/[slug]` uses for this stat. */
    percentileLabel: (topPercent: number) => `Top ${topPercent}%`,
    freezeUsedNote: 'Freeze used — streak safe.',
    tomorrowTeaser: "Tomorrow's question lands at 9:00 ET.",
    noQuestionToday: "There's no daily question live right now — check back at 9:00 ET.",
    priceStaleNotice: 'Prices are catching up — try again in a minute.',
  },
  errors: {
    PRICE_UNAVAILABLE: 'Prices are catching up, try again in a minute.',
    QUESTION_LOCKED: 'This question already locked.',
    ALREADY_PICKED: "You've already picked this one.",
    UNDO_EXPIRED: 'Undo window closed — your pick stands.',
    AGE_ATTESTATION_REQUIRED: "Confirm you're 18+ to place a pick.",
    RATE_LIMITED: 'Too many attempts — try again shortly.',
    generic: 'Something went wrong. Try again.',
  },
  /** WS7-T10 (placement flow UI) section. */
  placement: {
    intro:
      "Five quick calls on real historical questions — see how you'd have done, tap by tap.",
    progressLabel: (index: number, total: number) => `Item ${index} of ${total}`,
    loading: 'Loading your 5 items…',
    loadErrorTitle: "Couldn't load placement",
    emptyPoolMessage: 'No placement items are available right now.',
    retry: 'Try again',
    needsIdentityTitle: 'Make a pick first',
    needsIdentityBody:
      "Placement needs an existing pick on this device before it can start — answer today's question, then come back here.",
    needsIdentityCta: "Go to today's question",
    yourCallPrefix: 'You called',
    resolvedPrefix: 'it resolved',
    resolvedOnPrefix: 'Resolved',
    nextButton: 'Next',
    finishButton: 'See your results',
    submitErrorFallback: 'Something went wrong. Please try again.',
    completeTitle: 'Your starting profile is ready',
    completeBody: (correct: number, total: number) =>
      `You called ${correct} of ${total} right. Those answers just seeded your starting profile.`,
    completeCta: "Go to today's question",
  },
} as const;

/** WS7-T6 (nemesis UI) section. */
export const nemesisCopy = {
  /** Shown on the "Meet your nemesis" assignment-reveal card (§2.3: Monday 09:00 ET). */
  assignmentHeading: (isRematch: boolean) => (isRematch ? 'Rematch is on' : 'Meet your nemesis'),
  assignmentBody: (opponentHandle: string, isRematch: boolean) =>
    isRematch
      ? `You and ${opponentHandle} are running it back this week.`
      : `${opponentHandle} is your nemesis this week. Same daily questions, head to head.`,
  viewMatchupCta: 'View matchup',

  requestRematchCta: 'Request rematch',
  rematchPendingLabel: (opponentHandle: string) =>
    `Rematch requested — waiting on ${opponentHandle}`,
  rematchIncomingLabel: (requesterHandle: string) => `${requesterHandle} wants a rematch`,
  rematchAcceptCta: 'Accept',
  rematchDeclineCta: 'Decline',
  rematchAcceptedLabel: "Rematch confirmed — you'll be paired starting next week",
  rematchDeclinedLabel: 'Rematch declined',

  historyEmpty: 'No nemesis history yet — your first assignment lands Monday 9am ET.',
} as const;
