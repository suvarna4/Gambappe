/**
 * WS9-T4: `buildQuestionUrl` never throws — a missing env var or slug degrades to `undefined`
 * (cosmetic CTA link only) rather than blocking the reveal transaction / reminder write that
 * calls it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildQuestionUrl } from '../src/lib/question-url.js';

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

describe('buildQuestionUrl', () => {
  afterEach(() => {
    if (ORIGINAL_APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  });

  it('builds a /q/{slug} deep link when both env and slug are present', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://receipts.example';
    expect(buildQuestionUrl('2026-07-19-test-question')).toBe(
      'https://receipts.example/q/2026-07-19-test-question',
    );
  });

  it('strips a trailing slash on NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://receipts.example/';
    expect(buildQuestionUrl('2026-07-19-test-question')).toBe(
      'https://receipts.example/q/2026-07-19-test-question',
    );
  });

  it('returns undefined (never throws) when NEXT_PUBLIC_APP_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(() => buildQuestionUrl('2026-07-19-test-question')).not.toThrow();
    expect(buildQuestionUrl('2026-07-19-test-question')).toBeUndefined();
  });

  it('returns undefined when slug is null/undefined', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://receipts.example';
    expect(buildQuestionUrl(null)).toBeUndefined();
    expect(buildQuestionUrl(undefined)).toBeUndefined();
  });
});
