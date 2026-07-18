/**
 * Behavior tests for the WS0-T2 contract pieces: errors, flags, clock, settings strictness,
 * handles, analytics catalog, enums.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiError,
  ERROR_CODES,
  errorEnvelope,
  errorEnvelopeSchema,
  successEnvelope,
} from '../src/errors.js';
import { FLAG_DEFAULTS, FLAG_NAMES, isFlagEnabled } from '../src/flags.js';
import { advanceTestClock, now, setTestClock } from '../src/clock.js';
import {
  PROFILE_SETTINGS_DEFAULTS,
  profileSettingsSchema,
  updateSettingsBodySchema,
} from '../src/schemas/settings.js';
import { ANIMALS, isReservedHandle, slugifyHandle } from '../src/handles.js';
import { ANALYTICS_EVENTS, isAnalyticsEventName } from '../src/types/analytics.js';
import { createPickBodySchema } from '../src/schemas/picks.js';
import { normalizedMarketSchema } from '../src/types/market.js';

describe('errors (Appendix C)', () => {
  it('has all 22 codes with the spec HTTP statuses', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(22);
    expect(ERROR_CODES.VALIDATION_FAILED).toBe(400);
    expect(ERROR_CODES.REVEAL_NOT_READY).toBe(423);
    expect(ERROR_CODES.PRICE_UNAVAILABLE).toBe(503);
    expect(ERROR_CODES.WALLET_ALREADY_LINKED).toBe(409);
    expect(ERROR_CODES.AGE_ATTESTATION_REQUIRED).toBe(422);
    // WS10-T2 contract-change (§15.2): duplicate daily question is its own 409, not a
    // generic VALIDATION_FAILED — matches ALREADY_PICKED/CLAIM_CONFLICT's "already exists" shape.
    expect(ERROR_CODES.DUPLICATE_DAILY_QUESTION).toBe(409);
    // WS10-T4 contract-change (§15.4): resolving an already-resolved report is its own 409
    // rather than reusing CLAIM_CONFLICT, which is reserved for WS2's claim-flow race.
    expect(ERROR_CODES.REPORT_ALREADY_RESOLVED).toBe(409);
  });

  it('ApiError carries code/status and produces a valid envelope', () => {
    const err = new ApiError('QUESTION_LOCKED', 'Locked at noon ET', { lock_at: 'x' });
    expect(err.status).toBe(422);
    const env = errorEnvelope(err);
    expect(errorEnvelopeSchema.parse(env)).toEqual({
      error: { code: 'QUESTION_LOCKED', message: 'Locked at noon ET', details: { lock_at: 'x' } },
    });
  });

  it('envelope helpers follow §9.1 shapes', () => {
    expect(errorEnvelope('NOT_FOUND')).toEqual({
      error: { code: 'NOT_FOUND', message: 'NOT_FOUND' },
    });
    expect(successEnvelope([1], { next_cursor: null })).toEqual({
      data: [1],
      meta: { next_cursor: null },
    });
    expect(successEnvelope({ a: 1 })).toEqual({ data: { a: 1 } });
  });
});

describe('flags (§4.6)', () => {
  it('has exactly the 9 spec flags, all defaulting off', () => {
    expect(FLAG_NAMES.sort()).toEqual(
      [
        'confidence_slider',
        'duo_queue',
        'wallet_linking',
        'web_push',
        'nemesis',
        'divergence_display',
        // kalshi_ws_ticker added by WS1-T6 (§7.3 P1.5) — named explicitly in the design
        // doc's task table, per the flag-naming convention this test pins.
        'kalshi_ws_ticker',
        'houses',
        'passkeys',
      ].sort(),
    );
    for (const name of FLAG_NAMES) expect(FLAG_DEFAULTS[name]).toBe(false);
  });

  it('reads FLAG_<NAME>=true from env', () => {
    expect(isFlagEnabled('duo_queue', {})).toBe(false);
    expect(isFlagEnabled('duo_queue', { FLAG_DUO_QUEUE: 'true' })).toBe(true);
    expect(isFlagEnabled('duo_queue', { FLAG_DUO_QUEUE: 'false' })).toBe(false);
    expect(isFlagEnabled('nemesis', { FLAG_NEMESIS: '1' })).toBe(true);
  });
});

describe('clock (§17.2)', () => {
  afterEach(() => setTestClock(null));

  it('returns real time without an override', () => {
    const before = Date.now();
    const t = now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('supports set + advance in test env', () => {
    setTestClock('2026-07-19T16:00:00Z');
    expect(now().toISOString()).toBe('2026-07-19T16:00:00.000Z');
    advanceTestClock(60_000);
    expect(now().toISOString()).toBe('2026-07-19T16:01:00.000Z');
  });
});

describe('ProfileSettings (§9.4)', () => {
  it('defaults exactly per spec', () => {
    expect(PROFILE_SETTINGS_DEFAULTS).toEqual({
      nemesis_paused: false,
      show_wallet_address: false,
      notifications: {
        email_reveal: true,
        email_nemesis: true,
        email_duo: true,
        email_product: false,
        push_reveal: true,
        push_nemesis: true,
        push_duo: true,
      },
    });
  });

  it('is strict — unknown keys rejected (server-managed state can never sneak in)', () => {
    expect(profileSettingsSchema.safeParse({ matchmaking_priority: true }).success).toBe(false);
    expect(
      updateSettingsBodySchema.safeParse({ nemesis_paused: true, priority_next_week: true })
        .success,
    ).toBe(false);
    expect(
      updateSettingsBodySchema.safeParse({ notifications: { email_reveal: false, bogus: 1 } })
        .success,
    ).toBe(false);
  });

  it('accepts a partial update incl. the timezone column passthrough', () => {
    const parsed = updateSettingsBodySchema.parse({
      notifications: { push_reveal: false },
      timezone: 'Europe/Berlin',
    });
    expect(parsed.timezone).toBe('Europe/Berlin');
  });
});

describe('handles (§6.1.2)', () => {
  it('has the curated 120-animal list, unique', () => {
    expect(ANIMALS).toHaveLength(120);
    expect(new Set(ANIMALS).size).toBe(120);
  });

  it('derives slugs deterministically', () => {
    expect(slugifyHandle('Fox #4821')).toBe('fox-4821');
    expect(slugifyHandle('Kingfisher #0042')).toBe('kingfisher-0042');
  });

  it('screens reserved terms incl. obvious variants', () => {
    expect(isReservedHandle('kalshi_official')).toBe(true);
    expect(isReservedHandle('P0lymarket')).toBe(true);
    expect(isReservedHandle('rece1pts')).toBe(true);
    expect(isReservedHandle('mod')).toBe(true);
    expect(isReservedHandle('modest')).toBe(false);
    expect(isReservedHandle('fox_hunter')).toBe(false);
  });
});

describe('analytics catalog (§13.1)', () => {
  it('has the 26 canonical events', () => {
    expect(ANALYTICS_EVENTS).toHaveLength(26);
    expect(isAnalyticsEventName('pick_created')).toBe(true);
    expect(isAnalyticsEventName('made_up_event')).toBe(false);
  });
});

describe('pick body (§6.2 step 1)', () => {
  it('never accepts a client-supplied source', () => {
    expect(createPickBodySchema.safeParse({ side: 'yes', source: 'share_card' }).success).toBe(
      false,
    );
    expect(createPickBodySchema.parse({ side: 'no', age_attested: true })).toEqual({
      side: 'no',
      age_attested: true,
    });
  });

  it('bounds confidence 50–100', () => {
    expect(createPickBodySchema.safeParse({ side: 'yes', confidence: 49 }).success).toBe(false);
    expect(createPickBodySchema.safeParse({ side: 'yes', confidence: 100 }).success).toBe(true);
  });
});

describe('NormalizedMarket (§7.1)', () => {
  it('rejects prices outside [0.01, 0.99]', () => {
    const base = {
      venue: 'kalshi',
      venueMarketId: 'KX-TEST-1',
      title: 'Test market',
      category: 'sports',
      closeTime: new Date(),
      venueUrl: 'https://kalshi.com/markets/kx-test-1',
      raw: {},
    };
    expect(normalizedMarketSchema.safeParse({ ...base, yesPrice: 0.5 }).success).toBe(true);
    expect(normalizedMarketSchema.safeParse({ ...base, yesPrice: 0 }).success).toBe(false);
    expect(normalizedMarketSchema.safeParse({ ...base, yesPrice: 1 }).success).toBe(false);
  });
});
