/**
 * User-facing copy (design doc §10.6): "every user-facing string lives in
 * `apps/web/lib/copy.ts` (single reviewable file; no scattered literals)." This file seeds the
 * strings WS7-T2 (home + question page) needs; other workstreams add their own sections here
 * rather than starting a second copy file.
 *
 * Rules enforced by review (§10.6, checked again by WS14-T3's copy scan):
 *  - No money words, no "bet"/"wager"/"stake"/"$" anywhere (INV-8) — say "pick"/"call".
 *  - Mechanic names are plain words (P11): streak, receipt, called it.
 *  - The two claim-nudge strings and the publicness sentence are PINNED VERBATIM — they belong
 *    to WS7-T5 (claim flow UI) and WS11.3/13.3 (narration), not duplicated here until those
 *    tasks land, to avoid two sources of truth drifting.
 */

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
    /** WS7-T3 reveal sequence (§10.3): the percentile/streak count-up block. */
    percentileLabel: (pct: number) => `Better than ${pct}% of pickers.`,
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
} as const;
