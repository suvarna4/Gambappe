/**
 * SW9-T3 · The busted-streak receipt template renders the OBITUARY layout from the replay-bound
 * run — real length and b./d. dates from `bustedRun`, never `profile.bestStreak` (the pre-SW9
 * template guessed with live profile fields). Structural render (renderToStaticMarkup), same
 * approach as `og-print-shop.test.tsx`; the full satori PNG path is covered by
 * `test/integration/busted-streak-binding.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PickRow, ProfileRow, QuestionRow } from '@receipts/db';
import { buildPick, buildProfile, buildQuestion } from '@receipts/db/testing';

import { renderReceiptTemplate } from '@/lib/og/templates';
import type { ReceiptOgData } from '@/lib/og/entities';

function receiptData(overrides: Partial<ReceiptOgData> = {}): ReceiptOgData {
  const profile = buildProfile({ currentStreak: 0, bestStreak: 9 }) as unknown as ProfileRow;
  const question = buildQuestion('market-1', {
    slug: 'test-death-day',
    headline: 'Does the streak survive?',
  }) as unknown as QuestionRow;
  const pick = buildPick(question.id as unknown as string, profile.id, {
    side: 'yes',
    yesPriceAtEntry: 0.29,
    result: 'win',
  }) as unknown as PickRow;
  return { pick, question, profile, variant: 'win', bustedRun: null, ...overrides };
}

describe('renderReceiptTemplate busted_streak variant (SW9-T3)', () => {
  it('renders the obituary line from the REAL run length and dates, not profile.bestStreak', () => {
    const html = renderToStaticMarkup(
      renderReceiptTemplate(
        receiptData({
          variant: 'busted_streak',
          bustedRun: { length: 5, startedOn: '2026-03-01', endedOn: '2026-03-05' },
        }),
      ),
    );
    expect(html).toContain('Here lies a 5-day streak.');
    expect(html).toContain('b. 2026-03-01 — d. 2026-03-05');
    // The pre-SW9 heuristic line read the live profile field (bestStreak = 9) — gone.
    expect(html).not.toContain('9-day');
  });

  it('a WIN pick renders the tombstone when the binding says so (death is by absence, §2)', () => {
    const html = renderToStaticMarkup(
      renderReceiptTemplate(
        receiptData({
          variant: 'busted_streak',
          bustedRun: { length: 3, startedOn: '2026-04-01', endedOn: '2026-04-03' },
        }),
      ),
    );
    // The held side + entry price still print (the "died holding" position)…
    expect(html).toContain('29¢');
    // …under the obituary headline.
    expect(html).toContain('Here lies a 3-day streak.');
  });

  it('plain win/loss receipts carry no obituary line', () => {
    for (const variant of ['win', 'loss'] as const) {
      const html = renderToStaticMarkup(renderReceiptTemplate(receiptData({ variant })));
      expect(html).not.toContain('Here lies');
      expect(html).not.toContain('b. 2026');
    }
  });
});
