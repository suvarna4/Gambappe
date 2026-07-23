/**
 * INV-8 money-word filter (docs/xtrace-hackathon-tasks.md XH-T3). Applied to every string
 * field the generation service produces — betting/wagering language must never reach a
 * rendered surface, and the regex (core config, shared with the copy-test literal) already
 * covers morphological variants a bare `\b`-anchored token would miss.
 */
import { MONEY_WORD_REGEX_SOURCE } from '@receipts/core';

export const moneyWordRe = new RegExp(MONEY_WORD_REGEX_SOURCE, 'i');

export function filterLines(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !moneyWordRe.test(line));
}
