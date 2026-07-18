/**
 * Test factories (design doc §17.2): profile/question/pick builders. Builders are pure
 * (row objects out); `insert*` helpers persist them. `buildGradedQuestionScenario` produces
 * a revealed daily with 3 graded picks — the WS0-T3 acceptance fixture.
 */
import { uuidv7 } from 'uuidv7';
import { slugifyHandle } from '@receipts/core';
import type { Db } from '../client.js';
import { markets, picks, profiles, questions } from '../schema/index.js';
import type { placementAnswers, placementItems } from '../schema/index.js';

export type ProfileRow = typeof profiles.$inferInsert;
export type MarketRow = typeof markets.$inferInsert;
export type QuestionRow = typeof questions.$inferInsert;
export type PickRow = typeof picks.$inferInsert;
export type PlacementItemRow = typeof placementItems.$inferInsert;
export type PlacementAnswerRow = typeof placementAnswers.$inferInsert;

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

/** Deterministic-ish default instant used when the caller doesn't pass one. */
const T0 = new Date('2026-07-19T13:00:00Z'); // 09:00 ET open on question day

/**
 * Unique default question_date per call — the §5.3 partial unique index allows only one
 * daily per date, so parallel fixtures must not collide.
 */
function nextQuestionDate(): string {
  const d = new Date('2026-01-01T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + nextSeq());
  return d.toISOString().slice(0, 10);
}

export function buildProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  const n = nextSeq();
  const handle = overrides.handle ?? `Fox #${String(1000 + n)}`;
  return {
    id: uuidv7(),
    kind: 'ghost',
    status: 'active',
    handle,
    slug: overrides.slug ?? slugifyHandle(handle),
    ghostSecretHash: 'test-ghost-secret-hash',
    lastSeenAt: T0,
    ageAttestedAt: T0,
    settings: {},
    ...overrides,
  };
}

export function buildMarket(overrides: Partial<MarketRow> = {}): MarketRow {
  const n = nextSeq();
  return {
    id: uuidv7(),
    venue: 'kalshi',
    venueMarketId: `KX-TEST-${n}`,
    title: `Test market ${n}`,
    category: 'sports',
    closeTime: new Date(T0.getTime() + 12 * 3600_000),
    status: 'open',
    yesPrice: 0.63,
    yesPriceUpdatedAt: T0,
    venueUrl: `https://kalshi.example/markets/kx-test-${n}`,
    raw: { fixture: true },
    ...overrides,
  };
}

export function buildQuestion(
  marketId: string,
  overrides: Partial<QuestionRow> = {},
): QuestionRow {
  const n = nextSeq();
  const questionDate =
    overrides.questionDate !== undefined ? overrides.questionDate : nextQuestionDate();
  return {
    id: uuidv7(),
    kind: 'daily',
    marketId,
    questionDate,
    slug: overrides.slug ?? `${questionDate}-test-question-${n}`,
    headline: `Will the test resolve yes? #${n}`,
    yesLabel: 'Yes',
    noLabel: 'No',
    openAt: T0, // 09:00 ET
    lockAt: new Date(T0.getTime() + 3 * 3600_000), // 12:00 ET
    revealAt: new Date(T0.getTime() + 11 * 3600_000), // 20:00 ET
    status: 'open',
    ...overrides,
  };
}

export function buildPick(
  questionId: string,
  profileId: string,
  overrides: Partial<PickRow> = {},
): PickRow {
  return {
    id: uuidv7(),
    questionId,
    profileId,
    side: 'yes',
    yesPriceAtEntry: 0.63,
    priceStampedAt: T0,
    pickedAt: new Date(T0.getTime() + 3600_000),
    source: 'web',
    result: 'pending',
    ...overrides,
  };
}

/** Edge per §8.1: (win?1:0) − implied entry prob of the chosen side. */
export function computeEdge(side: 'yes' | 'no', yesPriceAtEntry: number, won: boolean): number {
  const pSide = side === 'yes' ? yesPriceAtEntry : 1 - yesPriceAtEntry;
  return (won ? 1 : 0) - pSide;
}

export interface GradedQuestionScenario {
  market: MarketRow;
  question: QuestionRow;
  profiles: [ProfileRow, ProfileRow, ProfileRow];
  picks: [PickRow, PickRow, PickRow];
}

/**
 * A revealed, graded daily with 3 picks: two YES winners, one NO loser (outcome YES).
 * Crowd/lock snapshots and edges are internally consistent.
 */
export function buildGradedQuestionScenario(
  overrides: { questionDate?: string } = {},
): GradedQuestionScenario {
  const questionDate = overrides.questionDate ?? nextQuestionDate();
  const market = buildMarket({ status: 'resolved', outcome: 'yes' });
  const gradedAt = new Date(T0.getTime() + 9 * 3600_000);
  const question = buildQuestion(market.id as string, {
    questionDate,
    status: 'revealed',
    yesCount: 2,
    noCount: 1,
    crowdYesAtLock: 2,
    crowdNoAtLock: 1,
    yesPriceAtLock: 0.66,
    outcome: 'yes',
    settledAt: gradedAt,
    revealedAt: new Date(T0.getTime() + 11 * 3600_000),
  });
  const [p1, p2, p3] = [buildProfile(), buildProfile(), buildProfile()];
  const pickRows: [PickRow, PickRow, PickRow] = [
    buildPick(question.id as string, p1.id as string, {
      side: 'yes',
      yesPriceAtEntry: 0.6,
      result: 'win',
      edge: computeEdge('yes', 0.6, true),
      gradedAt,
    }),
    buildPick(question.id as string, p2.id as string, {
      side: 'yes',
      yesPriceAtEntry: 0.65,
      result: 'win',
      edge: computeEdge('yes', 0.65, true),
      gradedAt,
    }),
    buildPick(question.id as string, p3.id as string, {
      side: 'no',
      yesPriceAtEntry: 0.7,
      result: 'loss',
      edge: computeEdge('no', 0.7, false),
      gradedAt,
    }),
  ];
  return { market, question, profiles: [p1, p2, p3], picks: pickRows };
}

/** A curated historical placement item (§5.5, WS4-T8). Test-fixture defaults, not production content. */
export function buildPlacementItem(overrides: Partial<PlacementItemRow> = {}): PlacementItemRow {
  const n = nextSeq();
  return {
    id: uuidv7(),
    title: `Test placement item #${n}`,
    category: 'sports',
    yesLabel: 'Yes',
    noLabel: 'No',
    historicalYesPrice: 0.6,
    historicalCrowdYesPct: 55,
    outcome: 'yes',
    resolvedOn: '2024-01-01',
    active: true,
    ...overrides,
  };
}

export function buildPlacementAnswer(
  profileId: string,
  placementItemId: string,
  overrides: Partial<PlacementAnswerRow> = {},
): PlacementAnswerRow {
  return {
    profileId,
    placementItemId,
    side: 'yes',
    answeredAt: T0,
    ...overrides,
  };
}

/** Persist a scenario (FK-ordered) — used by integration tests. */
export async function insertGradedQuestionScenario(
  db: Db,
  scenario: GradedQuestionScenario = buildGradedQuestionScenario(),
): Promise<GradedQuestionScenario> {
  await db.insert(markets).values(scenario.market);
  await db.insert(questions).values(scenario.question);
  await db.insert(profiles).values(scenario.profiles);
  await db.insert(picks).values(scenario.picks);
  return scenario;
}
