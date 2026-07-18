import { describe, expect, it } from 'vitest';
import { normalizeEmailForDuplicateCheck } from '../src/duplicate-accounts.js';

describe('normalizeEmailForDuplicateCheck (§14.4)', () => {
  it('AC: a.b+c@gmail.com variants all normalize to the same family', () => {
    const variants = [
      'a.b+c@gmail.com',
      'ab@gmail.com',
      'a.b@gmail.com',
      'ab+c@gmail.com',
      'a.b+x+y@gmail.com', // multiple +segments after the dotted root — still same family
    ];
    const normalized = variants.map(normalizeEmailForDuplicateCheck);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('ab@gmail.com');
  });

  it('treats googlemail.com as an alias of gmail.com', () => {
    expect(normalizeEmailForDuplicateCheck('a.b+c@googlemail.com')).toBe(
      normalizeEmailForDuplicateCheck('ab@gmail.com'),
    );
  });

  it('strips the plus-tag for non-Gmail domains too', () => {
    expect(normalizeEmailForDuplicateCheck('user+tag@outlook.com')).toBe('user@outlook.com');
    expect(normalizeEmailForDuplicateCheck('user+tag@example.com')).toBe('user@example.com');
  });

  it('does NOT strip dots for non-Gmail domains — dots are meaningful there', () => {
    expect(normalizeEmailForDuplicateCheck('a.b@outlook.com')).toBe('a.b@outlook.com');
    expect(normalizeEmailForDuplicateCheck('a.b@example.com')).toBe('a.b@example.com');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeEmailForDuplicateCheck('  A.B+C@GMAIL.COM  ')).toBe('ab@gmail.com');
  });

  it('only strips from the first + onward, dropping any later + segments too', () => {
    expect(normalizeEmailForDuplicateCheck('a+b+c@example.com')).toBe('a@example.com');
  });

  it('returns malformed input (no @) lowercased/trimmed rather than throwing', () => {
    expect(normalizeEmailForDuplicateCheck('  NotAnEmail  ')).toBe('notanemail');
  });

  it('leaves genuinely different Gmail accounts distinct', () => {
    expect(normalizeEmailForDuplicateCheck('alice@gmail.com')).not.toBe(
      normalizeEmailForDuplicateCheck('bob@gmail.com'),
    );
  });
});
