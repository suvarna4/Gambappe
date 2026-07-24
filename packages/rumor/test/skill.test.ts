import { describe, expect, it } from 'vitest';

import { DEFAULT_STANCE_CUES, defaultRumorSkill, isRumorSkill } from '../src/index.js';

describe('defaultRumorSkill — the untrained baseline pin', () => {
  it('pins every default exactly (trained-vs-untrained comparisons depend on this)', () => {
    const skill = defaultRumorSkill('2026-07-24');
    expect(skill).toEqual({
      version: 1,
      cutoff: '2026-07-24',
      lexiconDeltas: {},
      stanceCueWeights: DEFAULT_STANCE_CUES,
      upvoteAlpha: 1,
      homerDiscount: 0.5,
      recencyHalfLifeDays: 7,
      temperature: 1,
      record: {},
    });
  });

  it('copies the cue table (mutating a skill never touches the module default)', () => {
    const skill = defaultRumorSkill('2026-07-24');
    skill.stanceCueWeights['leverage'] = 0;
    expect(DEFAULT_STANCE_CUES['leverage']).toBe(-0.7);
  });
});

describe('isRumorSkill', () => {
  it('accepts a default skill and a JSON round-trip', () => {
    const skill = defaultRumorSkill('2026-07-24');
    expect(isRumorSkill(skill)).toBe(true);
    expect(isRumorSkill(JSON.parse(JSON.stringify(skill)))).toBe(true);
  });

  it('rejects structural corruption', () => {
    const good = defaultRumorSkill('2026-07-24');
    expect(isRumorSkill(null)).toBe(false);
    expect(isRumorSkill({})).toBe(false);
    expect(isRumorSkill({ ...good, version: 2 })).toBe(false);
    expect(isRumorSkill({ ...good, upvoteAlpha: 0 })).toBe(false);
    expect(isRumorSkill({ ...good, temperature: -1 })).toBe(false);
    expect(isRumorSkill({ ...good, recencyHalfLifeDays: 0 })).toBe(false);
    expect(isRumorSkill({ ...good, stanceCueWeights: { leverage: 'high' } })).toBe(false);
    expect(isRumorSkill({ ...good, record: null })).toBe(false);
  });
});
