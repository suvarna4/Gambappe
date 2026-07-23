/**
 * Pure prompt builders (docs/xtrace-hackathon-tasks.md XH-T3) — one per generation kind, each
 * taking a typed context object and returning `{ system, user }`. No I/O, no truncation:
 * `generate.ts` truncates `memory` (COMPANION_SEARCH_LIMIT items, 500 chars each) before
 * calling these.
 */

/**
 * Shared preamble, worded once and reused verbatim across all three kinds (pinned by the
 * snapshot test below — a change here is a deliberate prompt-drift decision, not an accident).
 */
const SHARED_PREAMBLE = [
  'Facts in the RECORD block are authoritative and complete. Never state a score, record, ' +
    'streak or result that is not in RECORD. MEMORY items are color: callbacks, tone, ' +
    'grudges. If MEMORY contradicts RECORD, RECORD wins.',
  'Never mention money, betting, stakes, wagers, dollar amounts, or odds as prices.',
  'Write in the product voice: terse, dry, receipt-flavored. No emoji. No hashtags.',
].join('\n');

export interface PromptPair {
  system: string;
  user: string;
}

export interface BanterContext {
  viewerHandle: string;
  opponentHandle: string;
  record: { wins: number; losses: number; draws: number };
  currentWeek: { scoreViewer: number; scoreOpponent: number; daysRemaining: number } | null;
  lastVerdictLine: string | null;
  memory: string[];
}

export interface CalloutDraftContext {
  challengerHandle: string;
  targetHandle: string;
  record: { wins: number; losses: number; draws: number };
  memory: string[];
}

export interface RecapContext {
  handle: string;
  seasonName: string;
  stats: {
    pairings: number;
    wins: number;
    losses: number;
    draws: number;
    bestStreak: number;
    calloutsSent: number;
    calloutsWon: number;
  };
  verdictLines: string[];
  memory: string[];
}

function formatMemory(memory: string[]): string {
  return memory.length > 0 ? memory.map((line) => `- ${line}`).join('\n') : '(none)';
}

export function buildBanterPrompt(ctx: BanterContext): PromptPair {
  const record =
    `RECORD: ${ctx.viewerHandle} vs ${ctx.opponentHandle} — ` +
    `${ctx.record.wins}-${ctx.record.losses}-${ctx.record.draws} lifetime.`;
  const week = ctx.currentWeek
    ? `Current week: ${ctx.viewerHandle} ${ctx.currentWeek.scoreViewer} — ` +
      `${ctx.currentWeek.scoreOpponent} ${ctx.opponentHandle}, ` +
      `${ctx.currentWeek.daysRemaining} day(s) remaining.`
    : 'No active week in progress.';
  const verdict = ctx.lastVerdictLine
    ? `Last verdict: ${ctx.lastVerdictLine}`
    : 'No prior verdict on record.';
  const user = [
    record,
    week,
    verdict,
    `MEMORY:\n${formatMemory(ctx.memory)}`,
    'Write 1-3 short banter lines for the viewer to read about this rivalry.',
  ].join('\n\n');
  return { system: SHARED_PREAMBLE, user };
}

export function buildCalloutDraftPrompt(ctx: CalloutDraftContext): PromptPair {
  const record =
    `RECORD: ${ctx.challengerHandle} vs ${ctx.targetHandle} — ` +
    `${ctx.record.wins}-${ctx.record.losses}-${ctx.record.draws} lifetime.`;
  const user = [
    record,
    `MEMORY:\n${formatMemory(ctx.memory)}`,
    `Write a few short callout-message drafts ${ctx.challengerHandle} could send to challenge ` +
      `${ctx.targetHandle} to a rematch.`,
  ].join('\n\n');
  return { system: SHARED_PREAMBLE, user };
}

export function buildRecapPrompt(ctx: RecapContext): PromptPair {
  const record =
    `RECORD: ${ctx.handle}, ${ctx.seasonName} — ${ctx.stats.pairings} pairing(s), ` +
    `${ctx.stats.wins}-${ctx.stats.losses}-${ctx.stats.draws}, best streak ${ctx.stats.bestStreak}, ` +
    `${ctx.stats.calloutsSent} callout(s) sent (${ctx.stats.calloutsWon} won).`;
  const verdicts =
    ctx.verdictLines.length > 0
      ? `VERDICTS (in order):\n${ctx.verdictLines.map((line) => `- ${line}`).join('\n')}`
      : 'VERDICTS: (none)';
  const user = [
    record,
    verdicts,
    `MEMORY:\n${formatMemory(ctx.memory)}`,
    `Write a short season recap for ${ctx.handle} covering ${ctx.seasonName}: a title and 1-4 ` +
      'paragraphs.',
  ].join('\n\n');
  return { system: SHARED_PREAMBLE, user };
}
