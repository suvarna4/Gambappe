/**
 * XH-T1 (docs/xtrace-hackathon-tasks.md): companion API schemas. Pins the response caps to
 * the config constants (no literal 3s — XH-T3's zodOutputFormat schemas reuse the same
 * constants) and the null-means-degraded contract the XH-T6 island relies on.
 */
import { describe, expect, it } from 'vitest';
import { COMPANION_BANTER_MAX_LINES, COMPANION_DRAFT_MAX } from '../src/config.js';
import {
  draftCalloutBodySchema,
  draftCalloutResponseSchema,
  getBanterResponseSchema,
  seasonRecapContentSchema,
} from '../src/schemas/companion.js';

const TS = '2026-07-23T12:00:00.000Z';

describe('getBanterResponseSchema', () => {
  it('accepts 1..COMPANION_BANTER_MAX_LINES lines and a null (degraded) banter', () => {
    expect(
      getBanterResponseSchema.safeParse({ banter: { lines: ['line'], generated_at: TS } }).success,
    ).toBe(true);
    expect(getBanterResponseSchema.safeParse({ banter: null }).success).toBe(true);
  });

  it('rejects empty lines, over-cap counts, over-length lines, and missing generated_at', () => {
    expect(
      getBanterResponseSchema.safeParse({ banter: { lines: [], generated_at: TS } }).success,
    ).toBe(false);
    const over = Array.from({ length: COMPANION_BANTER_MAX_LINES + 1 }, () => 'x');
    expect(
      getBanterResponseSchema.safeParse({ banter: { lines: over, generated_at: TS } }).success,
    ).toBe(false);
    expect(
      getBanterResponseSchema.safeParse({
        banter: { lines: ['x'.repeat(281)], generated_at: TS },
      }).success,
    ).toBe(false);
    expect(getBanterResponseSchema.safeParse({ banter: { lines: ['x'] } }).success).toBe(false);
  });
});

describe('draftCalloutBodySchema', () => {
  it('requires target_profile_id and rejects extra keys (.strict())', () => {
    const id = '018f6f2a-0000-7000-8000-000000000001';
    expect(draftCalloutBodySchema.safeParse({ target_profile_id: id }).success).toBe(true);
    expect(draftCalloutBodySchema.safeParse({}).success).toBe(false);
    expect(
      draftCalloutBodySchema.safeParse({ target_profile_id: id, extra: 1 }).success,
    ).toBe(false);
  });
});

describe('draftCalloutResponseSchema', () => {
  it('accepts 1..COMPANION_DRAFT_MAX drafts, rejects empty and over-cap', () => {
    expect(draftCalloutResponseSchema.safeParse({ drafts: ['zing'] }).success).toBe(true);
    expect(draftCalloutResponseSchema.safeParse({ drafts: [] }).success).toBe(false);
    const over = Array.from({ length: COMPANION_DRAFT_MAX + 1 }, () => 'x');
    expect(draftCalloutResponseSchema.safeParse({ drafts: over }).success).toBe(false);
  });
});

describe('seasonRecapContentSchema', () => {
  it('bounds title and paragraphs', () => {
    expect(
      seasonRecapContentSchema.safeParse({ title: 'The Season', paragraphs: ['p1'] }).success,
    ).toBe(true);
    expect(seasonRecapContentSchema.safeParse({ title: '', paragraphs: ['p1'] }).success).toBe(
      false,
    );
    expect(seasonRecapContentSchema.safeParse({ title: 't', paragraphs: [] }).success).toBe(
      false,
    );
    expect(
      seasonRecapContentSchema.safeParse({ title: 't', paragraphs: ['a', 'b', 'c', 'd', 'e'] })
        .success,
    ).toBe(false);
  });
});
