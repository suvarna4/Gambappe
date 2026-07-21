import { describe, expect, it } from 'vitest';
import {
  buildObituaryFacts,
  CLAIM_NUDGE_COPY,
  CLAIM_PROMPT_CTA,
  CLAIM_PUBLICNESS_STATEMENT,
  obituaryCopy,
  shareCopy,
} from '@/lib/copy';

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

  // D-J8 (WS21-T1): the "claim" wording was amended to "Save" per docs/journeys-plan.md §5 +
  // the owner decision of 2026-07-21; these re-pin the new nudge strings verbatim.
  it('streak nudge matches the WS21-T1 pinned copy verbatim', () => {
    expect(CLAIM_NUDGE_COPY.streak).toBe(
      'Your streak lives on this device. Save it — free, ten seconds.',
    );
  });

  it('fingerprint nudge matches the WS21-T1 pinned copy verbatim', () => {
    expect(CLAIM_NUDGE_COPY.fingerprint).toBe(
      'Your fingerprint is ready. Save your record to get your nemesis.',
    );
  });

  it('no Save-flow copy uses "claim" wording (D-J8 grep gate)', () => {
    const allCopy = [CLAIM_PROMPT_CTA, ...Object.values(CLAIM_NUDGE_COPY)].join(' ');
    expect(allCopy).not.toMatch(/claim/i);
  });

  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = [CLAIM_PUBLICNESS_STATEMENT, ...Object.values(CLAIM_NUDGE_COPY)].join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});

/** WS8-T2 (§10.5 share sheet) section — same INV-8 money-word rule applied to its own copy. */
describe('§10.5 share sheet copy', () => {
  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = Object.values(shareCopy).join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});

/**
 * SW9-T2 (obituary-handoff §3.2/§4): the "survived" fact templates + the builder that turns
 * `broken_run.freezes_survived`/`longest_odds_cents` into `ObituaryCard`'s `facts` prop.
 */
describe('obituaryCopy survived-fact templates + buildObituaryFacts (SW9-T2)', () => {
  it('singularizes "1 freeze spent" but pluralizes for any other count', () => {
    expect(obituaryCopy.survivedFreeze(1)).toBe('1 freeze spent');
    expect(obituaryCopy.survivedFreeze(2)).toBe('2 freezes spent');
    expect(obituaryCopy.survivedFreeze(0)).toBe('0 freezes spent');
  });

  it('renders the odds fact in cents, never dollars (INV-8)', () => {
    expect(obituaryCopy.survivedOdds(29)).toBe('Longest odds held: 29¢');
  });

  it('degrades to an empty list when nothing survived and no odds are resolvable', () => {
    expect(buildObituaryFacts(0, null)).toEqual([]);
  });

  it('omits the freeze line when freezes_survived is 0 (not worth a line)', () => {
    expect(buildObituaryFacts(0, 29)).toEqual([{ text: 'Longest odds held: 29¢' }]);
  });

  it('omits the odds line when longest_odds_cents is null (no resolvable pick)', () => {
    expect(buildObituaryFacts(2, null)).toEqual([{ text: '2 freezes spent' }]);
  });

  it('includes both lines, freeze first, when both are present', () => {
    expect(buildObituaryFacts(1, 29)).toEqual([
      { text: '1 freeze spent' },
      { text: 'Longest odds held: 29¢' },
    ]);
  });

  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = [
      obituaryCopy.survivedFreeze(3),
      obituaryCopy.survivedOdds(29),
      ...Object.values(obituaryCopy).filter((v: unknown): v is string => typeof v === 'string'),
    ].join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});
