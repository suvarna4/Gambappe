/**
 * SW8-T3 · The pick input-method source enum. The actual `pick_created` emission is interaction-
 * level (covered by the SW1-T5 Playwright suite, which asserts the property on a swipe pick vs a
 * well pick); this pins the vocabulary.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PICK_SOURCE,
  isPickInputSource,
  PICK_INPUT_SOURCES,
} from '@/lib/pick-input-source';

describe('pick input source', () => {
  it('is exactly the five input methods (swipe / well / key / push / widget)', () => {
    expect([...PICK_INPUT_SOURCES]).toEqual(['swipe', 'well', 'key', 'push', 'widget']);
  });

  it('defaults to well (the tap-button flow)', () => {
    expect(DEFAULT_PICK_SOURCE).toBe('well');
    expect(isPickInputSource(DEFAULT_PICK_SOURCE)).toBe(true);
  });

  it('type-guards unknown strings', () => {
    expect(isPickInputSource('swipe')).toBe(true);
    expect(isPickInputSource('mouse')).toBe(false);
  });
});
