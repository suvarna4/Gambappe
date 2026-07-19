/**
 * §4.6 feature flags. Pins every flag's default (all off at rest) and the env-resolution
 * rules — a default change here is a `contract-change` PR by definition.
 */
import { describe, expect, it } from 'vitest';

import { FLAG_DEFAULTS, FLAG_NAMES, flagEnvVar, isFlagEnabled } from '../src/flags.js';

describe('flag defaults', () => {
  it('every flag defaults off (the §4.6 "UI renders coherently with any flag off" contract)', () => {
    for (const name of FLAG_NAMES) {
      expect(FLAG_DEFAULTS[name]).toBe(false);
    }
  });

  it('swipe_ballot exists and is off by default (SW0-T3)', () => {
    expect(FLAG_DEFAULTS.swipe_ballot).toBe(false);
    expect(FLAG_NAMES).toContain('swipe_ballot');
  });
});

describe('isFlagEnabled', () => {
  it('maps a flag to FLAG_<UPPER> and honors true/1 / false/0 / unset', () => {
    expect(flagEnvVar('swipe_ballot')).toBe('FLAG_SWIPE_BALLOT');
    expect(isFlagEnabled('swipe_ballot', { FLAG_SWIPE_BALLOT: 'true' })).toBe(true);
    expect(isFlagEnabled('swipe_ballot', { FLAG_SWIPE_BALLOT: '1' })).toBe(true);
    expect(isFlagEnabled('swipe_ballot', { FLAG_SWIPE_BALLOT: 'false' })).toBe(false);
    expect(isFlagEnabled('swipe_ballot', { FLAG_SWIPE_BALLOT: '0' })).toBe(false);
    expect(isFlagEnabled('swipe_ballot', {})).toBe(false);
    expect(isFlagEnabled('swipe_ballot', { FLAG_SWIPE_BALLOT: '' })).toBe(false);
  });
});
