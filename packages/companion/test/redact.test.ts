import { describe, expect, it } from 'vitest';

import { scrubPii } from '../src/redact.js';

describe('scrubPii', () => {
  it('redacts an email-like substring', () => {
    expect(scrubPii('reach me at fox@example.com anytime')).toBe('reach me at [redacted] anytime');
  });

  it('redacts a formatted phone number', () => {
    expect(scrubPii('call me at (555) 123-4567 tonight')).toBe('call me at [redacted] tonight');
  });

  it('redacts a digits-only phone number', () => {
    expect(scrubPii('text 5551234567 now')).toBe('text [redacted] now');
  });

  it('passes ordinary text with short numbers through unchanged', () => {
    expect(scrubPii('won 3-1 again')).toBe('won 3-1 again');
    expect(scrubPii('up 12 points')).toBe('up 12 points');
  });
});
