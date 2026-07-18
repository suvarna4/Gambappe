import { describe, expect, it } from 'vitest';
import { CLAIM_NUDGE_COPY, CLAIM_PUBLICNESS_STATEMENT } from '@/lib/copy';

/**
 * §10.6 AC (WS7-T5): "copy string matches §10.6 verbatim." Pinned exact text, quoted directly
 * from the design doc, so any accidental edit/paraphrase to `copy.ts` fails CI instead of
 * silently drifting from the spec.
 */
describe('§10.6 pinned copy', () => {
  it('INV-6 publicness statement matches §10.6 verbatim', () => {
    expect(CLAIM_PUBLICNESS_STATEMENT).toBe(
      "Your picks, results, and rating are public — that's the point. You can stay pseudonymous forever.",
    );
  });

  it('streak nudge matches §10.6 verbatim', () => {
    expect(CLAIM_NUDGE_COPY.streak).toBe(
      'Your ghost has a 3-day streak. Claim it before this device loses it.',
    );
  });

  it('fingerprint nudge matches §10.6 verbatim', () => {
    expect(CLAIM_NUDGE_COPY.fingerprint).toBe(
      'Your fingerprint is ready. Claim your record to get assigned your nemesis.',
    );
  });

  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = [CLAIM_PUBLICNESS_STATEMENT, ...Object.values(CLAIM_NUDGE_COPY)].join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});
