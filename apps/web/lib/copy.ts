/**
 * The single user-facing-copy file (design doc §10.6: "Every user-facing string lives in
 * `apps/web/lib/copy.ts` — no scattered literals"). No page/task has created this file yet
 * on `main` as of this branch; WS7-T6 (nemesis UI) creates it and seeds its own strings.
 * Other in-flight tasks (WS7-T2/T4/T5/T10 etc.) may add this same file independently on
 * their own branches — if so, merging is just combining named exports, nothing structural.
 *
 * Only §10.6's two pinned strings (publicness sentence, claim-nudge triggers) are prescribed
 * verbatim by the design doc; everything else here is this task's own copy, written to the
 * spirit of §10.6 (plain mechanic names, no money/bet language, INV-8).
 */

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
