/**
 * OG/Twitter meta description for a question page (§10.5: `og:description` = "one-line
 * state", example given: "The crowd says 63%. Lock is at noon ET."). Pure/testable.
 */
import type { QuestionPublic } from '@receipts/core';
import { formatEtClock } from './format-et';

export function describeQuestionState(question: QuestionPublic): string {
  switch (question.status) {
    case 'scheduled':
      return `Opens at ${formatEtClock(question.open_at)}.`;
    case 'open':
      return `Pick your side — locks at ${formatEtClock(question.lock_at)}.`;
    case 'locked': {
      if (!question.crowd) return `Locked. Reveal at ${formatEtClock(question.reveal_at)}.`;
      return `The crowd says ${question.crowd.pct_yes}% ${question.yes_label}. Reveal at ${formatEtClock(question.reveal_at)}.`;
    }
    case 'revealed': {
      const outcomeLabel = question.outcome === 'yes' ? question.yes_label : question.no_label;
      if (!question.crowd) return `${outcomeLabel} — the results are in.`;
      return `${outcomeLabel}. The crowd said ${question.crowd.pct_yes}% ${question.yes_label}.`;
    }
    case 'voided':
      return 'Voided by the venue — streak-safe for everyone who answered.';
    default:
      return question.headline;
  }
}
