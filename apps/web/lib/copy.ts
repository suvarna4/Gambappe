/**
 * Single source of every user-facing string (design doc §10.6: "Every user-facing string
 * lives in `apps/web/lib/copy.ts` (single reviewable file; no scattered literals) including
 * narration templates' rendered strings (§13.3)." — WS14-T3 scans this file for money words).
 *
 * Seeded independently by WS7-T2 (the `copy.question`/`copy.errors` sections), WS7-T5 (the
 * flat `CLAIM_*` exports, claim flow UI), WS7-T6 (`nemesisCopy`, nemesis UI), WS7-T10
 * (`copy.placement`), WS7-T8 (`threadCopy`, threads + reactions UI), and WS8-T2 (`shareCopy`,
 * share sheet) before any had landed on `main` — merged here on rebase. Later tasks should add
 * their own section to this file rather than starting a second copy file.
 *
 * Rules enforced in review (§10.6):
 *  - No money amounts, "bets", stake sizes, or venue balances (INV-8) — say "pick"/"call".
 *  - Mechanic names are plain words (P11): nemesis, duo, streak, freeze, receipt, called it.
 *  - The two Save-nudge strings and the publicness sentence below are PINNED VERBATIM —
 *    do not paraphrase them (§11.3, §13.3 both point back at this file for the rendered text).
 *    D-J8 (WS21-T1): the sign-in ask is the single word "Save"; the nudge strings were amended
 *    off the old "claim" wording per `docs/journeys-plan.md` §5 (WS21-T1) + the owner decision
 *    of 2026-07-21. The new text is re-pinned verbatim in `test/copy.test.ts`.
 */
import { DAILY_OPEN_LOCAL, PAIRING_REACTION_SET, PRODUCT_NAME, SCHEDULE_TZ } from '@receipts/core';
import { zonedTimeToUtc } from './curation';
import { formatClock } from './format-et';

/**
 * WS15-T8/T9: the daily open time, rendered by the SAME display-timezone formatter every
 * dynamic clock label uses (`formatClock` → `DISPLAY_TZ`, Pacific) — one zone, one style,
 * derived from `DAILY_OPEN_LOCAL` (§0.1 rule 4). The reference date is arbitrary: ET and PT
 * shift DST together, so the ET→PT rendering of a fixed ET wall time is date-independent.
 */
const DAILY_OPEN_PT = formatClock(
  zonedTimeToUtc('2026-01-15', DAILY_OPEN_LOCAL, SCHEDULE_TZ).toISOString(),
); // "12:00 AM PT" while DAILY_OPEN_LOCAL is 03:00 ET

/** INV-6, pinned verbatim (§10.6): shown on the claim/signup screen. */
export const CLAIM_PUBLICNESS_STATEMENT =
  "Your picks, results, and rating are public — that's the point. You can stay pseudonymous forever.";

/**
 * §11.3 claim-prompt triggers: streak reaching 3, 5th pick, viewing a nemesis/duo surface as a
 * ghost. §10.6 pins exactly two nudge strings (streak, fingerprint) for those three triggers.
 * `NEMESIS_MIN_PICKS` (packages/core/src/config.ts) is 5 — the same number as the "5th pick"
 * trigger — so reaching the 5th pick *is* reaching nemesis-fingerprint eligibility. The 5th-pick
 * trigger and the nemesis/duo-surface trigger are therefore both instances of "your fingerprint
 * is ready" and share the fingerprint copy; only the streak trigger gets its own pinned string.
 * SPEC-GAP(WS7-T5): §10.6 doesn't say this explicitly — flagging in case a future edit adds a
 * dedicated 5th-pick string.
 *
 * D-J8 (WS21-T1): "Sign-in is Save." These two strings were amended off the old "claim it"/"claim
 * your record" wording — the mechanic is unchanged, only the verb (`docs/journeys-plan.md` §5,
 * owner decision 2026-07-21). Pinned verbatim: re-asserted in `test/copy.test.ts`, no gold on the
 * ask (the surface that renders them stays neutral — D-J8).
 */
export const CLAIM_NUDGE_COPY = {
  streak: 'Your streak lives on this device. Save it — free, ten seconds.',
  fingerprint: 'Your fingerprint is ready. Save your record to get your nemesis.',
} as const;

export type ClaimNudgeTrigger = keyof typeof CLAIM_NUDGE_COPY;

export const CLAIM_PROMPT_CTA = 'Save';
export const CLAIM_PROMPT_DISMISS_LABEL = 'Not now';

/**
 * Shared-device guard (§6.3): the "that you?" confirm before saving a ghost's record on a
 * possibly-shared device. The design doc gives this as an illustrative example inside §6.3's
 * prose, not a §10.6-pinned string, so it's a template here. D-J8 (WS21-T1): amended off "claiming
 * {handle}" — the ask is "Save", never "claim".
 */
export function ghostConfirmationCopy(handle: string, streak: number, gradedPicks: number): string {
  const streakPart = streak > 0 ? `${streak}-day streak` : 'no streak yet';
  const picksPart = gradedPicks === 1 ? '1 pick' : `${gradedPicks} picks`;
  return `You're about to save ${handle} — ${streakPart}, ${picksPart}. That you?`;
}

export const CLAIM_CONFIRM_YES_LABEL = "That's me — continue";
export const CLAIM_CONFIRM_NOT_ME_LABEL = "This isn't me";

/**
 * D-J8 (WS21-T1): the /claim sign-in screen, restyled as a neutral TicketFrame "SAVE YOUR RECORD"
 * ticket (`docs/journeys-plan.md` §5). The admit bar is split into the frame's two header slots
 * (brand left, context right); the heading + subheading carry the "nothing to buy, never costs
 * money" reassurance. No gold anywhere on this ask.
 */
export const CLAIM_SIGNIN_ADMIT_LEFT = 'GAMBAPPE';
export const CLAIM_SIGNIN_ADMIT_RIGHT = 'SAVE YOUR RECORD';
export const CLAIM_SIGNIN_HEADING = "Nothing to buy. Just don't lose your record.";
export const CLAIM_SIGNIN_SUBHEADING = 'Free — email, Google, or passkey. Nothing here ever costs money.';
export const CLAIM_SIGNIN_GOOGLE_LABEL = 'Continue with Google';
export const CLAIM_SIGNIN_X_LABEL = 'Continue with X';
export const CLAIM_SIGNIN_EMAIL_LABEL = 'Continue with email';
export const CLAIM_SIGNIN_EMAIL_PLACEHOLDER = 'you@example.com';
export const CLAIM_SIGNIN_EMAIL_SUBMIT_LABEL = 'Save';
export const CLAIM_SIGNIN_EMAIL_SENT =
  "Check your email for a sign-in link. You can close this and come back once you've clicked it.";

/** INV-9 (§6.2 step 0 wording: "an explicit 'I'm 18+' confirm"). */
export const CLAIM_AGE_ATTEST_HEADING = 'One more thing';
export const CLAIM_AGE_ATTEST_LABEL = "I'm 18 or older";
export const CLAIM_AGE_ATTEST_SUBMIT_LABEL = 'Confirm & save';
export const CLAIM_AGE_ATTEST_FOOTNOTE = `${PRODUCT_NAME} never holds money — picks are for competition, not wagers.`;

export const CLAIM_SUCCESS_HEADING = 'Saved. This record is yours now.';
export const CLAIM_SUCCESS_CASE_B_CTA = 'Answer a few quick questions to get placed';
export const CLAIM_ALREADY_CLAIMED = "You've already saved this record. Nothing to do here.";
export const CLAIM_GENERIC_ERROR = 'Something went wrong saving your record. Try again.';

export const EIGHTEEN_PLUS_FOOTER_NOTICE = `18+ only. ${PRODUCT_NAME} never holds money — picks are for competition, not wagers.`;

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
    tomorrowTeaser: `Tomorrow's question lands at ${DAILY_OPEN_PT}.`,
    noQuestionToday: `There's no daily question live right now — check back at ${DAILY_OPEN_PT}.`,
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
    intro: "Five quick calls on real historical questions — see how you'd have done, tap by tap.",
    /** SW6-T1: the placement swipe-card eyebrow — the game framing, not a quiz. */
    callIt: 'Call it',
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
  /** The assignment card's second "well" button (design-diff audit: `docs/mockups/swipe-ux.html`
   * line 825's "Pause weeks" — links to the real `nemesis_paused` toggle on `/settings`
   * (`SettingsClient.tsx`'s `saveNemesisPaused`), not a fabricated action; this card just gives
   * it a shortcut. */
  pauseWeeksCta: 'Pause weeks',

  requestRematchCta: 'Request rematch',
  rematchPendingLabel: (opponentHandle: string) =>
    `Rematch requested — waiting on ${opponentHandle}`,
  rematchIncomingLabel: (requesterHandle: string) => `${requesterHandle} wants a rematch`,
  rematchAcceptCta: 'Accept',
  rematchDeclineCta: 'Decline',
  rematchAcceptedLabel: "Rematch confirmed — you'll be paired starting next week",
  rematchDeclinedLabel: 'Rematch declined',

  historyEmpty: 'No nemesis history yet — your first assignment lands Monday 9am ET.',

  /** SW5-T1/SW10-T1 · The daily receipt "flip" during an active nemesis week (swipe-ux-plan
   * §2.9). The opponent's pick is sealed until reveal (SW10-T1: not "until you locked" — see
   * `NemesisFlip`'s doc comment for why that original timing was unimplementable); the note
   * makes the actual unseal moment explicit. Narration is data-generated (§13.3) and passed in.
   * No money words (INV-8). */
  flipSealedNote: (opponentHandle: string) => `${opponentHandle} · unsealed at reveal`,
  flipTally: (opponentHandle: string, youWins: number, oppWins: number) =>
    youWins === oppWins
      ? `Week even, ${youWins}–${oppWins}`
      : youWins > oppWins
        ? `You lead ${youWins}–${oppWins}`
        : `${opponentHandle} leads ${oppWins}–${youWins}`,
  /** SW5-T4 preset stamp reactions (matchup trash talk) — preset-only, no free text (P1).
   * SW10-T4: re-exports `@receipts/core`'s `PAIRING_REACTION_SET` rather than a second literal
   * (§0.1 rule 4 — single source of truth); that constant's own doc comment explains why this
   * is a SEPARATE set from `REACTION_SET`/`reactionLabels` below. */
  reactionStamps: PAIRING_REACTION_SET,

  /** SW5-T2 · The Friday verdict card + rematch-by-swipe (swipe-ux-plan §2.9). Both players get
   * a card; the loser's is the richer one (P3). The week's last swipe is emotional — right =
   * run it back (affirmative-right, D-SW9), left = a new stranger. No money words (INV-8). */
  verdictWon: 'You took the week',
  verdictLost: 'Taken down',
  verdictDrew: 'Dead even',
  verdictScore: (you: number, opp: number) => `${you}–${opp}`,
  /** Loser/winner cards' data-derived lines — score-margin only (SW10-T2: `nemesisHistoryEntrySchema`
   * carries `my_score`/`their_score` and nothing else — no edge, no streak-of-weeks — so this
   * asserts only the margin the week was decided by, never "edge"/"out-edged" framing, per the
   * pinned AC: "grep both lines" for that wording — including the margin-0 branch below, so it
   * stays "tiebreak", never "edged"). A `won`/`lost` outcome with `scoreMargin === 0` is a real,
   * reachable state — the scorer breaks a tied week on aggregate edge internally
   * (`packages/engine/src/scoring.ts`), not just draws it — so the "N clear" phrasing gets a
   * margin-0 variant instead of printing the same false "0 clear" boast the draw line was fixed
   * for (fable review of PR #84, round 2; wording itself corrected in round 3). */
  verdictLoserLine: (opponentHandle: string, scoreMargin: number) =>
    scoreMargin === 0
      ? `${opponentHandle} took this one on the tiebreak. The rematch button is right there.`
      : `${opponentHandle} closed it out ${scoreMargin} clear. The rematch button is right there.`,
  verdictWinnerLine: (opponentHandle: string, scoreMargin: number) =>
    scoreMargin === 0
      ? `You took this one on the tiebreak, dead level with ${opponentHandle} otherwise.`
      : `You closed it out ${scoreMargin} clear of ${opponentHandle}.`,
  /** Drawn card's line — `scoreMargin` is always 0 for a draw, so the winner/loser lines'
   * "closed it out N clear" framing would render a false "0 clear" boast (fable review of
   * PR #84). A draw has no margin to report at all. */
  verdictDrawLine: (opponentHandle: string) => `Dead even with ${opponentHandle}. Break the tie?`,
  newFate: 'New fate',
  runItBack: 'Run it back',
} as const;

/**
 * WS20-T2 (journeys-plan §5, D-J4) · The same-side card state (seam 2 — this block, and only this
 * block, is WS20-T2's copy surface). When rivals took the SAME side, the day is decided by price
 * edge, not by both being right/wrong: the cheaper (lower implied-entry) side wins, and if both
 * were wrong the smaller implied loss wins. Rendered by `SameSideState` on the matchup/verdict
 * surfaces (`NemesisMatchupCard`/`VerdictCard`). All viewer-relative. No money words (INV-8) —
 * cents render as "¢", never "$"; "price"/"cheaper" describe the pick's cost, not a wager.
 */
export const sameSideCopy = {
  /** The masking-tape state label (journeys-plan §2 `TapeLabel`), exact wording from the v3
   * artifact ch. 03. */
  tape: 'SAME SIDE · EDGE DECIDES',
  /** Owner caption for the viewer's own column. */
  youOwner: 'YOU',
  /** Mono price caption under each stamp — implied entry cents. */
  priceCaption: (cents: number) => `@ ${cents}¢`,
  /** Pre-settle footer: the cheaper entry price beats the other by its margin. A same-minute price
   * tie (winner decided by the earlier stamp, D-J4) has no margin to report — name the tiebreak. */
  priceEdge: (yourPrice: number, theirPrice: number) =>
    yourPrice < theirPrice
      ? `YOUR PRICE BEATS THEIRS BY ${theirPrice - yourPrice}¢`
      : yourPrice > theirPrice
        ? `THEIR PRICE BEATS YOURS BY ${yourPrice - theirPrice}¢`
        : 'SAME PRICE · EARLIER STAMP DECIDES',
  /** Post-settle framing — both took the correct side; the cheaper entry took the day. */
  bothRight: (winner: 'you' | 'them' | 'draw') =>
    winner === 'them'
      ? 'both right — they called it cheaper'
      : 'both right — you called it cheaper',
  /** Post-settle framing — both wrong; the smaller implied loss took the day. */
  bothWrong: (winner: 'you' | 'them' | 'draw') =>
    winner === 'you' ? 'both wrong — you lost less' : 'both wrong — they lost less',
} as const;

/** WS8-T2 (share cards + share sheet, §10.5) section. */
/**
 * SW1-T2 · Swipe-ballot chrome (swipe-ux-plan §2.3, §2.12). Side names come from the question
 * (`yes_label`/`no_label`); these are the fixed bits of furniture. No money words (INV-8).
 */
export const ballotCopy = {
  /** Rail + hint arrows (side name is appended/prepended by the component). */
  againstArrow: '←',
  forArrow: '→',
  /** WS18-T3: the stack's up-swipe skip affordance (D-J2) — glyph + short label for the key hint. */
  skipArrow: '↑',
  skipHint: 'SKIP',
  /** Tap wells — the always-present accessible fallback (D-SW7). Glyphs pair with the label. */
  wellForGlyph: '✓',
  wellAgainstGlyph: '✕',
  /** Card group aria-label; `{yes}`/`{no}` are the venue side words. Points AT users to the
   * buttons below (the keyboard/AT path) rather than promising a custom key handler on the card. */
  cardAriaLabel: (headline: string, forLabel: string, againstLabel: string) =>
    `${headline}. Swipe the card, or use the ${againstLabel} and ${forLabel} buttons below to pick.`,
  /** aria-live announcement when the receipt prints. */
  receiptPrinted: (sideLabel: string, cents: number) =>
    `Receipt printed — ${sideLabel} at ${cents} cents.`,
  /** Static state of the printed undo link once the 60s window closes (§2.4). */
  undoLocked: 'locked ✓',
  /** Receipt footer-left: the crowd stays sealed until lock (§9.3). `{time}` is the lock ET. */
  crowdSealed: (time: string) => `CROWD HIDDEN UNTIL LOCK · ${time}`,
  /** Idle-nudge sr hint (visually the card sways; SR users get the wells). */
  swipeHint: 'Swipe the card, or use the buttons below.',
  /** Design-diff audit · the peeking next-day card's real-data label, once
   * `GET /questions/tomorrow` confirms one exists (`docs/swipe-ux-plan.md` §2.5's under-card
   * bullet, pinned verbatim: "headline hidden — shows only 'TOMORROW · opens 9:00 ET'"). The
   * `UnderCard`'s flat fallback (`copy.question.tomorrowTeaser`) covers every other case —
   * curation hasn't reached tomorrow yet, or the fetch fails. */
  tomorrowPeekLabel: (time: string) => `TOMORROW · opens ${time}`,
} as const;

/**
 * WS18-T3 · The single mixed stack deck on `/` (journeys plan §5, D-J2). Progress chip, the
 * headliner's streak/rival footer, the skip caveat, and the cleared end-state. No money words
 * (INV-8) — asserted in `test/copy.test.ts`.
 */
export const stackCopy = {
  /** Topbar progress chip: which of the M dealt cards you're on. */
  progress: (n: number, m: number) => `${n} of ${m}`,
  /** Headliner footer — only the daily headliner carries the streak (D-J2). */
  streakRides: 'STREAK RIDES THIS',
  /** Headliner rival chip, lit when the viewer's active nemesis has a sealed pick on the shared
   * question (`rival_sealed` on the feed). `{handle}` is the rival's handle. */
  rivalSealed: (handle: string) => `⚔ ${handle} IS IN · SEALED`,
  /** One-line reassurance shown after the headliner is skipped: it re-enqueues and comes back. */
  headlinerSkipCaveat: 'Headliner parked — it comes back before lock.',
  /** Cleared end-state (foil moment). */
  clearedTitle: 'Stack cleared',
  clearedThrown: (n: number) => `${n} thrown`,
  clearedSkipped: (n: number) => `${n} skipped`,
  clearedBlurb: 'Nothing left on the deck. Come back for the next drop.',
  sweatLink: "See what you're sweating",
} as const;

/**
 * SW4-T1 · The busted-streak obituary (swipe-ux-plan §2.7, principle P3 — the loser is the
 * protagonist). Data-generated from the pick log; no user-authored text. Deadpan-affectionate —
 * the STREAK dies, never the user; no imagery beyond a candle, no real-world death references.
 * No money words (INV-8).
 */
export const obituaryCopy = {
  eyebrow: 'OBITUARY · STREAK',
  title: (days: number) => `Here lies a ${days}-day streak.`,
  dates: (start: string, end: string) => `b. ${start} — d. ${end}`,
  survivedLabel: 'Survived',
  /** SW9-T2 (obituary-handoff §3.2/§4): the two "survived" facts derivable from `broken_run`
   * (`freezes_survived`, `longest_odds_cents`) — the mock's "hardest day" fact has no data
   * source and stays omitted (§5 out of scope). Cents render as "¢", never "$" (INV-8). */
  survivedFreeze: (freezesSurvived: number) =>
    `${freezesSurvived} freeze${freezesSurvived === 1 ? '' : 's'} spent`,
  survivedOdds: (longestOddsCents: number) => `Longest odds held: ${longestOddsCents}¢`,
  causeOfDeath: (sideLabel: string, cents: number) => `Died holding ${sideLabel} @ ${cents}¢.`,
  stamp: 'Busted',
  rip: (days: number) => `RIP ${days}`,
  bury: 'Bury it',
  share: 'Share the obituary',
  /** The comeback framing shown beside the tombstone — tomorrow is nine hours away. */
  consolation: "Streak 0. Everyone's is, eventually.",
  /** SW4-T3 · The profile graveyard shelf (§2.7): broken streaks as headstones beside the
   * trophies (P3). Empty state is affectionate, not sad. */
  graveyardHeading: 'The graveyard',
  graveyardEmpty: 'No funerals yet.',
  graveyardRip: (days: number) => `RIP ${days}`,
  graveyardCalledIt: (count: number) => `Called it ×${count}`,
} as const;

/**
 * SW9-T2 (obituary-handoff §3.2/§4): builds `ObituaryCard`'s `facts` prop from `broken_run`'s
 * two derivable fields. Degrades to 0-2 lines (the card itself tolerates 0-3, per SW4-T1):
 * `freezes_survived === 0` isn't worth a line (nothing was survived), and a `null`
 * `longest_odds_cents` (§3.2: "null if none") means no run pick was resolvable.
 */
export function buildObituaryFacts(
  freezesSurvived: number,
  longestOddsCents: number | null,
): { text: string }[] {
  const facts: { text: string }[] = [];
  if (freezesSurvived > 0) facts.push({ text: obituaryCopy.survivedFreeze(freezesSurvived) });
  if (longestOddsCents !== null) facts.push({ text: obituaryCopy.survivedOdds(longestOddsCents) });
  return facts;
}

/**
 * WS19-T2 (journeys-plan §5, seam 2 — the sweat/settle copy block, owned here): the Sweat room
 * (`/sweat`, open positions by settle-time, D-J3) plus the settle-on-resolution presentation on
 * the question page (locked → "settles when it settles", revealed → "SETTLED {time}"). No money
 * words (INV-8): drift and entry are quoted in implied-probability cents ("¢"), never a stake or
 * a dollar amount. The `copy.test.ts` money-word scan covers this whole object.
 */
export const sweatCopy = {
  /** Page heading + the room's mono eyebrow. */
  heading: 'The sweat',
  eyebrow: 'OPEN POSITIONS',
  /** Sub-line under the heading — plain framing of what the room is. */
  intro: 'Everything you have riding, soonest to settle first.',
  /** Empty state (no pending picks): affectionate nudge back to the stack. */
  emptyTitle: 'Nothing riding right now.',
  emptyBody: 'No open calls. Head back to the stack and make some.',
  emptyCta: 'Back to the stack',

  /** SweatRow · the held side + its stamped entry price ("YES @ 63¢"). */
  entryAt: (sideLabel: string, cents: number) => `${sideLabel} @ ${cents}¢`,
  /** SweatRow · signed price drift of the held side since entry; glyph pairs with the sign so
   * colour is never the only signal (§10.4). `flat`/`unknown` stay neutral. */
  driftUp: (cents: number) => `▲ ${cents}¢`,
  driftDown: (cents: number) => `▼ ${cents}¢`,
  driftFlat: '— even',
  driftUnknown: '—',
  /** SweatRow · the settle-when column caption. */
  settleWhenCaption: 'Settles',

  /** Question-page locked state (D-J3): replaces the reveal countdown. `{time}` is the target
   * settle instant, rendered by the shared clock formatter. */
  settlesWhenItSettles: 'SETTLES WHEN IT SETTLES',
  settlesWhenSub: (time: string) => `Whenever the venue calls it — around ${time}.`,
  /** Question-page settled (revealed) state header (D-J3): stamped with the real settle time. */
  settledAt: (time: string) => `SETTLED ${time}`,
} as const;

export const shareCopy = {
  shareButtonLabel: 'Share your receipt',
  sheetHeading: 'Share this',
  formatStoryLabel: 'Story',
  formatSquareLabel: 'Square',
  webShareLabel: 'Share',
  downloadLabel: 'Download',
  copyLinkLabel: 'Copy link',
  copyLinkCopiedLabel: 'Copied!',
  closeLabel: 'Close',
  genericError: 'Something went wrong preparing your share card. Try again.',
} as const;

/** SW3-T1 (docs/swipe-ux-plan.md §2.6): the pre-reveal hush, T-10s before a locked question's
 * `reveal_at`. `roomCount` is approximate by design — "drama, not accounting." */
export const hushCopy = {
  frozenChip: 'FROZEN',
  roomCount: (n: number) => `${n} in the room`,
} as const;

/** WS7-T8 (threads + reactions UI) section. */
export const threadCopy = {
  heading: 'Thread',
  empty: 'No posts yet — be the first to say something.',
  loadMore: 'Load more',
  /** Textarea placeholder — the post box itself (§9.2 AC: "post box gated with claim prompt";
   * the box is always visible, only submitting/focusing it while unclaimed opens the prompt). */
  postPlaceholder: 'Add to the thread…',
  postSubmit: 'Post',
  postClaimGateCta: 'Claim your account to post',
  postError: 'Could not post that — try again.',
  reactionError: 'Could not react — try again.',
  loadError: 'Could not load the thread — try again.',
  /** Accessible labels for the four `REACTION_SET` emoji (§5.6/Appendix D) — plain-word
   * descriptions rather than the raw glyph, so a screen reader announces something meaningful
   * (mirrors §10.4's "never color alone" ethos: an emoji alone isn't a sufficient label). */
  reactionLabels: {
    '🔥': 'Fire',
    '💀': 'Skull',
    '🧾': 'Receipt',
    '🫡': 'Salute',
  } as const,
} as const;

/** WS7-T9 (settings UI) section — §9.2/§9.4: pause nemesis, notifications, deletion.
 * `show_wallet_address` has no toggle here — that's WS12-T3's "Badge + settings + unlink"
 * scope, not this task's. */
export const settingsCopy = {
  heading: 'Settings',
  claimRequiredNotice: 'Claim your account to manage settings.',
  loadError: 'Could not load your settings — try again.',
  saveError: 'Could not save — try again.',

  nemesisHeading: 'Nemesis',
  nemesisPausedLabel: 'Pause nemesis matchmaking',
  nemesisPausedHint: "You won't be assigned a new nemesis while this is on.",

  notificationsHeading: 'Notifications',
  emailRevealLabel: 'Email at reveal',
  emailNemesisLabel: 'Email for nemesis updates',
  emailDuoLabel: 'Email for duo updates',
  emailProductLabel: 'Email for product updates',
  pushRevealLabel: 'Push at reveal',
  pushNemesisLabel: 'Push for nemesis updates',
  pushDuoLabel: 'Push for duo updates',

  deleteHeading: 'Delete account',
  deleteWarning: 'This permanently deletes your account and pick history. This cannot be undone.',
  deleteConfirmPrompt: (handle: string) => `Type "${handle}" to confirm`,
  deleteButton: 'Delete my account',
  deleteConfirmButton: 'Permanently delete',
  deleteError: 'Could not delete your account — try again.',
  deleteDoneHeading: "Your account's been deleted",
  deleteDoneBody: 'Your picks and profile are gone. Thanks for playing.',
  deleteDoneHomeLink: 'Home',
} as const;

/** WS7-T7 (duo UI) section (design doc §8.5/§8.9/§8.10, §9.2, §10.1 `/duos/[id]`, `/ladder`).
 * `DUO_TIER_NAMES` are the §8.10 "Tier display names (`Paper → Carbon → Ribbon → Ledger →
 * Archive`)" — primary copy is always "Tier N" (P11), the name secondary, per §8.10's own
 * wording ("'Tier 1..5' is primary copy, the name secondary"). Indexed 0 = tier 1. */
export const DUO_TIER_NAMES = ['Paper', 'Carbon', 'Ribbon', 'Ledger', 'Archive'] as const;

export function duoTierLabel(tier: number): string {
  const name = DUO_TIER_NAMES[tier - 1];
  return name ? `Tier ${tier} · ${name}` : `Tier ${tier}`;
}

export const duoCopy = {
  hubHeading: 'Your duo',
  claimRequiredNotice: 'Claim your account to join a duo.',
  loadError: 'Could not load your duo — try again.',

  /** §8.5 eligibility: `DUO_MIN_PICKS` graded picks, claimed + active, no active duo already. */
  notEligible: (gradedPicks: number, required: number) =>
    `${gradedPicks}/${required} graded picks — you'll be able to queue for a duo once you reach ${required}.`,

  notQueuedBody:
    "You're not in the duo queue right now. Partners are matched by rating — join and we'll pair you when a good match is waiting.",
  joinQueueCta: 'Join duo queue',
  joiningQueue: 'Joining…',
  joinQueueError: 'Could not join the queue — try again.',

  /** SPEC-GAP(ws7-t7): §9.2 has no endpoint for "am I currently queued" independent of
   * `GET /duo/current` (which only surfaces a MATCHED duo) — the hub infers queued state from
   * the join call's own response (a fresh `waiting` entry, or an `already_queued` eligibility
   * rejection treated as confirmation) rather than from page load. A page reload while still
   * waiting shows the "join queue" button again; clicking it just confirms you're already in
   * — see `DuoHubClient`'s header for the full explanation. */
  queuedBody:
    "You're in the queue — you'll be paired once a good match is waiting. This can take a little while.",
  leaveQueueCta: 'Leave queue',
  leavingQueue: 'Leaving…',
  leaveQueueError: 'Could not leave the queue — try again.',

  viewDuoCta: 'View your duo',
  viewLadderCta: 'View the ladder',

  matchScheduledLabel: 'Match starts',
  matchActiveLabel: 'Match in progress',
  matchScoreLabel: 'Score',
  noActiveMatch: 'No active match this window.',

  disbandHeading: 'Disband this duo',
  disbandWarning: 'This ends your duo immediately. Your partner is notified — there is no undo.',
  disbandButton: 'Disband duo',
  disbandConfirmPrompt: 'Disband your duo with {partner}? This cannot be undone.',
  disbandConfirmButton: 'Yes, disband',
  disbandCancelButton: 'Never mind',
  disbandError: 'Could not disband your duo — try again.',
  disbandDone: "Your duo's been disbanded.",

  matchesPlayedLabel: 'Matches played',
  ratingLabel: 'Rating',
  /** §8.9: "You two hit {joint}% together — {better|worse} than either of you alone" — the
   * design doc's own gate for "better" is `joint_hit_rate > max(acc_a, acc_b)`, but
   * `duoPublicSchema` (§9.2 `GET /duos/:id`) exposes only `joint_hit_rate` and `synergy`
   * (= joint − MEAN(acc_a, acc_b), per §8.9's `expected` definition) — individual partner
   * accuracies aren't in the public contract, so the exact `max`-based comparison can't be
   * computed client-side. SPEC-GAP(ws7-t7): this uses `synergy`'s sign (joint vs. the mean) as
   * the pragmatic proxy — pinned copy's binary {better|worse} choice, no third "equal" variant,
   * so `synergy === 0` (rare with floats) reads as "worse" rather than inventing new wording. A
   * `packages/core` contract change exposing both individual accuracies would let a future task
   * implement the literal `max` comparison. */
  chemistryLine: (jointHitRatePct: number, synergy: number) =>
    `You two hit ${jointHitRatePct}% together — ${synergy > 0 ? 'better' : 'worse'} than either of you alone`,
  chemistryPending: 'Chemistry shows up once you have played more together.',

  historyHeading: 'Match history',
  historyEmpty: 'No matches yet.',

  ladderHeading: 'Duo ladder',
  ladderTierColumn: 'Tier',
  ladderDuoColumn: 'Duo',
  ladderWinsColumn: 'Wins',
  ladderRatingColumn: 'Rating',
  ladderEmpty: 'No duos on the ladder yet.',
  ladderLoadMore: 'Load more',

  /** SW5-T3 · The duo shared-deck tandem line + receipt (swipe-ux-plan §2.9). Partner's pick is
   * sealed until the viewer locks; then the split-or-match is its own micro-drama. No money
   * words (INV-8). */
  partnerSealed: (partnerHandle: string) => `${partnerHandle} locked · sealed until you pick`,
  tandemMatched: 'Matched',
  tandemSplit: 'Split — one of you is wrong',
  tandemReceiptHeading: 'Tandem receipt',

  /** SW10-T3(a) (wiring-gaps doc §4): the sealed partner chip on `SwipeBallot`'s footer — status
   * + timing only, never the partner's side (there is no "unsealed" variant of this copy). */
  partnerLockedChip: (partnerHandle: string, hoursAgo: number) =>
    `▣ ${partnerHandle} LOCKED · ${hoursAgo}h AGO`,
} as const;

/**
 * WS20-T4 (journeys plan §5, D-J5) · Call-outs + grudge book. This is the ONLY block this task
 * owns in `copy.ts` (§7 seam 2: "WS20-T4 (call-outs)") — it never edits another task's block.
 * Every surface here is stamp/preset copy only, no free-text input anywhere (§5 AC). No money
 * words (INV-8: no bet/stake/wager/$ — say "call", "pick", "record").
 */
export const calloutsCopy = {
  // --- "Call someone out" panel ---------------------------------------------------------------
  panelHeading: 'Call someone out',
  panelBody:
    'Challenge a past rival to a head-to-head week. Share the link — whoever opens it and accepts becomes your nemesis next week.',
  /** Shown when the viewer has no nemesis history yet to draw rival candidates from. */
  candidatesEmpty: 'No past rivals yet — call-out candidates show up once you have a nemesis history.',
  /** Per-candidate share button. `navigator.share` on capable devices, clipboard copy otherwise. */
  shareCta: 'Call out',
  sharing: 'Preparing link…',
  /** Clipboard fallback confirmation (no native share sheet). */
  linkCopied: 'Link copied — send it to your rival.',
  shareError: 'Could not create the call-out link — try again.',

  // --- Incoming call-out card -----------------------------------------------------------------
  incomingTapeLabel: "YOU'VE BEEN CALLED OUT",
  incomingBody: (challengerHandle: string) => `${challengerHandle} wants a head-to-head week.`,
  challengerRecordCta: 'See their record',
  acceptCta: 'Accept the duel',
  declineCta: 'Decline',
  accepting: 'Locking it in…',
  declining: 'Declining…',
  /** Accept while a ghost: the button routes through Save (D-J8) with a `?next=` return. This is
   * the affordance hint; the post-save return itself is the claim-flow's job (WS21-T2's incoming
   * call-out trigger). */
  acceptGhostHint: 'Save your record first — you land right back here to accept.',
  acceptedLine: (opponentHandle: string) => `Locked in — you face ${opponentHandle} next week.`,
  declinedLine: 'Call-out declined.',
  expiredLine: 'This call-out link has expired.',
  notFoundLine: 'This call-out link is no longer valid.',
  respondError: 'Could not respond to the call-out — try again.',

  // --- Locked-in confirmation (both sides' /rivals hubs after accept) --------------------------
  lockedInTapeLabel: 'LOCKED IN',
  lockedInLine: (opponentHandle: string) => `You face ${opponentHandle} next week — call-out accepted.`,

  // --- Grudge book (lifetime per-rival aggregate) ---------------------------------------------
  grudgeHeading: 'Grudge book',
  grudgeEmpty: 'No grudges yet — settle a nemesis week to start your record.',
  /** Lifetime head-to-head line per rival (§5: "they lead 2–1"). Draws are shown separately. */
  grudgeRecordLine: (myWins: number, theirWins: number) =>
    myWins > theirWins
      ? `you lead ${myWins}–${theirWins}`
      : myWins < theirWins
        ? `they lead ${theirWins}–${myWins}`
        : `even ${myWins}–${theirWins}`,
  grudgeDrawsNote: (draws: number) => (draws === 1 ? '· 1 draw' : `· ${draws} draws`),
  grudgeWeeksNote: (weeks: number) => (weeks === 1 ? '1 week' : `${weeks} weeks`),
  /** The existing rematch affordance, surfaced in the grudge book as a stamp (§5). */
  rematchCta: 'REMATCH',
  rematchSending: 'Requesting…',
  rematchPendingLine: (opponentHandle: string) => `Rematch requested — waiting on ${opponentHandle}`,
  rematchIncomingLine: (opponentHandle: string) => `${opponentHandle} wants to run it back`,
  rematchAcceptedLine: "Rematch on — you're paired starting next week",
  rematchError: 'Could not request the rematch — try again.',
} as const;
