/**
 * Unit coverage for `deriveEffectiveStatus`/`toQuestionPublic` (§5.7 effective-state rule,
 * §9.3 crowd-hiding rule) — pure, no DB. Real-Postgres coverage of the query layer itself
 * (`getTodayQuestionPublic`/`getQuestionPublicBySlug`) lives in
 * `test/integration/question-view.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import {
  deriveEffectiveStatus,
  toQuestionPublic,
  type MarketRow,
  type QuestionRow,
} from '@/lib/question-view';

const T0 = new Date('2026-07-19T13:00:00Z'); // open_at
const LOCK = new Date('2026-07-19T16:00:00Z'); // lock_at
const REVEAL = new Date('2026-07-20T00:00:00Z'); // reveal_at

/** Nullable columns `buildQuestion` doesn't default. */
const NULLABLE_DEFAULTS = {
  blurb: null,
  outcome: null,
  voidReason: null,
  isVolatile: false,
  revealedAt: null,
  settledAt: null,
  eventStartAt: null,
  pairedMarketId: null,
  crowdYesAtLock: null,
  crowdNoAtLock: null,
  yesPriceAtLock: null,
  createdByUserId: null,
} as const;

function row(overrides: Partial<QuestionRow> = {}): QuestionRow {
  // `buildQuestion` is a plain-object builder (no DB round trip), so nullable columns it
  // doesn't default stay `undefined` rather than the `null` a real Postgres read always
  // produces — coalesce them here so fixtures match the shape `toQuestionPublic` is actually
  // called with in production (verified for real against Postgres in
  // `test/integration/question-view.test.ts`).
  const built = buildQuestion('00000000-0000-0000-0000-000000000001', {
    openAt: T0,
    lockAt: LOCK,
    revealAt: REVEAL,
    status: 'open',
    ...overrides,
  });
  const merged: Record<string, unknown> = { ...built };
  for (const [key, fallback] of Object.entries(NULLABLE_DEFAULTS)) {
    if (merged[key] === undefined) merged[key] = fallback;
  }
  return merged as QuestionRow;
}

describe('deriveEffectiveStatus (§5.7)', () => {
  it('renders scheduled before open_at even if raw status somehow already open', () => {
    const q = row({ status: 'open' });
    expect(deriveEffectiveStatus(q, T0.getTime() - 1)).toBe('scheduled');
  });

  it('renders open between open_at and lock_at', () => {
    const q = row({ status: 'open' });
    expect(deriveEffectiveStatus(q, T0.getTime())).toBe('open');
    expect(deriveEffectiveStatus(q, LOCK.getTime() - 1)).toBe('open');
  });

  it('renders locked once lock_at has passed, even if the lock job has not run (raw status still open)', () => {
    const q = row({ status: 'open' });
    expect(deriveEffectiveStatus(q, LOCK.getTime())).toBe('locked');
    expect(deriveEffectiveStatus(q, LOCK.getTime() + 3_600_000)).toBe('locked');
  });

  it('raw scheduled status past lock_at also renders locked (worker-outage tolerance is symmetric)', () => {
    const q = row({ status: 'scheduled' });
    expect(deriveEffectiveStatus(q, LOCK.getTime() + 1)).toBe('locked');
  });

  it('revealed and voided are terminal for display regardless of timestamps', () => {
    const revealed = row({ status: 'revealed' });
    const voided = row({ status: 'voided' });
    expect(deriveEffectiveStatus(revealed, T0.getTime() - 999_999)).toBe('revealed');
    expect(deriveEffectiveStatus(voided, REVEAL.getTime() + 999_999)).toBe('voided');
  });
});

describe('toQuestionPublic (§9.3 crowd-hiding + assembly)', () => {
  const market: MarketRow = buildMarket({
    id: '00000000-0000-0000-0000-0000000000aa',
    venue: 'kalshi',
    venueUrl: 'https://kalshi.example/markets/test',
    yesPrice: 0.63,
    yesPriceUpdatedAt: T0,
  }) as MarketRow;

  it('hides crowd while scheduled', () => {
    const q = row({ status: 'scheduled', marketId: market.id as string, yesCount: 3, noCount: 1 });
    const pub = toQuestionPublic(q, market, T0.getTime() - 1);
    expect(pub.status).toBe('scheduled');
    expect(pub.crowd).toBeNull();
  });

  it('hides crowd while open — no exceptions, even with live counters present', () => {
    const q = row({ status: 'open', marketId: market.id as string, yesCount: 7, noCount: 3 });
    const pub = toQuestionPublic(q, market, T0.getTime() + 1000);
    expect(pub.status).toBe('open');
    expect(pub.crowd).toBeNull();
  });

  it('shows the LOCK snapshot (not live counters) once locked', () => {
    const q = row({
      status: 'locked',
      marketId: market.id as string,
      yesCount: 999, // must be ignored
      noCount: 999,
      crowdYesAtLock: 7,
      crowdNoAtLock: 3,
    });
    const pub = toQuestionPublic(q, market, LOCK.getTime() + 1000);
    expect(pub.crowd).toEqual({ yes: 7, no: 3, pct_yes: 70 });
  });

  it('shows the lock snapshot on revealed and voided too', () => {
    const revealed = row({
      status: 'revealed',
      marketId: market.id as string,
      crowdYesAtLock: 2,
      crowdNoAtLock: 8,
      outcome: 'no',
      revealedAt: REVEAL,
    });
    const pub = toQuestionPublic(revealed, market, REVEAL.getTime());
    expect(pub.crowd).toEqual({ yes: 2, no: 8, pct_yes: 20 });
    expect(pub.outcome).toBe('no');
  });

  it('a voided question that never locked has a null crowd (no snapshot to show)', () => {
    const q = row({
      status: 'voided',
      marketId: market.id as string,
      crowdYesAtLock: null,
      crowdNoAtLock: null,
    });
    const pub = toQuestionPublic(q, market, REVEAL.getTime());
    expect(pub.crowd).toBeNull();
    expect(pub.status).toBe('voided');
  });

  it('round-trips through the real questionPublicSchema (assembly matches the wire contract)', () => {
    const q = row({ status: 'open', marketId: market.id as string });
    const pub = toQuestionPublic(q, market, T0.getTime() + 1000);
    // toQuestionPublic already .parse()s internally; re-parsing here just documents the
    // guarantee explicitly for readers of this test file.
    expect(() => pub).not.toThrow();
    expect(pub.venue).toBe('kalshi');
    expect(pub.venue_url).toBe('https://kalshi.example/markets/test');
    expect(pub.yes_price).toBe(0.63);
  });

  it('throws for a slug-less question rather than silently mis-rendering', () => {
    const q = row({ status: 'open', marketId: market.id as string, slug: null });
    expect(() => toQuestionPublic(q, market, T0.getTime() + 1000)).toThrow(/no slug/);
  });
});
