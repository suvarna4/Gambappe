import { describe, expect, it } from 'vitest';
import {
  buildObituaryFacts,
  CLAIM_NUDGE_COPY,
  CLAIM_PROMPT_CTA,
  CLAIM_PUBLICNESS_STATEMENT,
  companionCopy,
  crowdCopy,
  departuresCopy,
  obituaryCopy,
  saveAskCopy,
  shareCopy,
  stackCopy,
  sweatCopy,
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

/** WS19-T2 (journeys-plan §5) · the sweat/settle copy block — same INV-8 money-word rule. Drift
 * and entry are implied-probability cents ("¢"), never a stake or a dollar amount. */
describe('WS19-T2 sweat/settle copy', () => {
  it('quotes entry + drift in cents, never dollars (INV-8)', () => {
    expect(sweatCopy.entryAt('Yes', 63)).toBe('Yes @ 63¢');
    expect(sweatCopy.driftUp(4)).toBe('▲ 4¢');
    expect(sweatCopy.driftDown(7)).toBe('▼ 7¢');
    expect(sweatCopy.settledAt('4:00 PM PT')).toBe('SETTLED 4:00 PM PT');
  });

  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = [
      sweatCopy.entryAt('Cuts', 71),
      sweatCopy.driftUp(3),
      sweatCopy.driftDown(3),
      sweatCopy.settlesWhenSub('4:00 PM PT'),
      sweatCopy.settledAt('4:00 PM PT'),
      ...Object.values(sweatCopy).filter((v: unknown): v is string => typeof v === 'string'),
    ].join(' ');
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

/** WS18-T3 (journeys plan §5) stack-deck copy — same INV-8 money-word rule. */
describe('stack-deck copy (WS18-T3)', () => {
  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = [
      stackCopy.progress(1, 2),
      stackCopy.streakRides,
      stackCopy.rivalSealed('rival'),
      stackCopy.headlinerSkipCaveat,
      stackCopy.clearedTitle,
      stackCopy.clearedThrown(1),
      stackCopy.clearedSkipped(1),
      stackCopy.clearedBlurb,
      stackCopy.sweatLink,
    ].join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});

/** WS24-T1 (§5 STRETCH) departures-board skin chrome — the same INV-8 money-word rule on this
 * task's OWN copy block (the row data is quoted through sweatCopy, scanned above). */
describe('departures-board copy (WS24-T1)', () => {
  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = Object.values(departuresCopy).join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});

/** WS21-T2 (§5 D-J8) · the Save-ask copy block — its record line quotes a streak/pick count only,
 * never a money amount, and it reuses (never edits) WS21-T1's pinned nudge strings + CTA. */
describe('save-ask copy (WS21-T2)', () => {
  it('builds the record-summary line from streak + pick counts, pluralizing correctly', () => {
    expect(saveAskCopy.recordLine(3, 5)).toBe('3-day streak · 5 picks on this device');
    expect(saveAskCopy.recordLine(1, 1)).toBe('1-day streak · 1 pick on this device');
    expect(saveAskCopy.recordLine(0, 2)).toBe('2 picks on this device');
    expect(saveAskCopy.recordLine(4, 0)).toBe('4-day streak on this device');
    // Nothing yet — a fully-forming record still reads as neutral value framing.
    expect(saveAskCopy.recordLine(0, 0)).toBe('Your record is forming on this device');
  });

  it('reuses WS21-T1 ticket chrome, never a new admit string', () => {
    expect(saveAskCopy.admitLeft).toBe('GAMBAPPE');
    expect(saveAskCopy.admitRight).toBe('SAVE YOUR RECORD');
  });

  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = [
      saveAskCopy.admitLeft,
      saveAskCopy.admitRight,
      saveAskCopy.recordLine(3, 5),
      saveAskCopy.recordLine(0, 0),
    ].join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });

  it('no Save-ask copy uses "claim" wording (D-J8 grep gate)', () => {
    const allCopy = [saveAskCopy.recordLine(1, 1), saveAskCopy.admitRight].join(' ');
    expect(allCopy).not.toMatch(/claim/i);
  });
});

/** WS22-T2 (§5 D-J7) `/crowd` boards copy — the same INV-8 money-word rule on this task's block. */
describe('crowd boards copy (WS22-T2)', () => {
  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = Object.values(crowdCopy).join(' ');
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

/** XH-T6 (docs/xtrace-hackathon-tasks.md) · the `CompanionBanter` island copy — same INV-8
 * money-word rule on this task's own block. */
describe('companion banter copy (XH-T6)', () => {
  it('conveys "AI-generated color — the record is the record"', () => {
    expect(companionCopy.disclaimer).toBe('AI-generated color — the record is the record.');
  });

  it('no copy references money words (§10.6/INV-8 review rule: bet|stake|wager|$)', () => {
    const allCopy = Object.values(companionCopy).join(' ');
    expect(allCopy).not.toMatch(/\bbet\b|\bstake\b|\bwager\b|\$/i);
  });
});
