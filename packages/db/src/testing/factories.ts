/**
 * Test factories (design doc §17.2): profile/question/pick builders. Builders are pure
 * (row objects out); `insert*` helpers persist them. `buildGradedQuestionScenario` produces
 * a revealed daily with 3 graded picks — the WS0-T3 acceptance fixture.
 */
import { uuidv7 } from 'uuidv7';
import { slugifyHandle } from '@receipts/core';
import type { CpuPersona } from '@receipts/core';
import type { Db } from '../client.js';
import { markets, picks, profiles, questions } from '../schema/index.js';
import type {
  callouts,
  companionArtifacts,
  companionXtraceGroups,
  duoMatches,
  duos,
  fingerprints,
  nemesisPairings,
  placementAnswers,
  placementItems,
  ratings,
  seasons,
  topicFollows,
} from '../schema/index.js';

export type ProfileRow = typeof profiles.$inferInsert;
export type MarketRow = typeof markets.$inferInsert;
export type QuestionRow = typeof questions.$inferInsert;
export type PickRow = typeof picks.$inferInsert;
export type PlacementItemRow = typeof placementItems.$inferInsert;
export type PlacementAnswerRow = typeof placementAnswers.$inferInsert;
export type FingerprintRow = typeof fingerprints.$inferInsert;
export type RatingRow = typeof ratings.$inferInsert;
export type SeasonRow = typeof seasons.$inferInsert;
export type NemesisPairingRow = typeof nemesisPairings.$inferInsert;
export type DuoRow = typeof duos.$inferInsert;
export type DuoMatchRow = typeof duoMatches.$inferInsert;
export type TopicFollowRow = typeof topicFollows.$inferInsert;
export type CalloutRow = typeof callouts.$inferInsert;
export type CompanionArtifactRow = typeof companionArtifacts.$inferInsert;
export type CompanionXtraceGroupRow = typeof companionXtraceGroups.$inferInsert;

let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

/**
 * Default instant used when the caller doesn't pass one — anchored to real wall-clock time
 * (not a fixed calendar date) so the relative offsets below (`lockAt`/`revealAt`/etc.) stay
 * safely in the future no matter how long a session or CI run has been going. A fixed date
 * (e.g. `2026-07-19T13:00:00Z`) is a time bomb: `placePickTx`'s `lock_at > now()` guard (§6.2)
 * silently rejects picks the moment real time crosses it, breaking every test relying on the
 * default `openAt`/`lockAt` without warning — see the regression that motivated this comment.
 */
const T0 = new Date(Date.now() - 3600_000); // 1h ago, so lockAt (T0+3h) is always ~2h out

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

/** WS26: a CPU rival profile — `kind='cpu'`, `bot_score=1.0`, persona set, no ghost secret. */
export function buildCpuProfile(
  persona: CpuPersona,
  overrides: Partial<ProfileRow> = {},
): ProfileRow {
  const n = nextSeq();
  const handle = overrides.handle ?? `Testbot #C${String(9000 + n)}`;
  return buildProfile({
    kind: 'cpu',
    handle,
    slug: slugifyHandle(handle),
    botScore: 1.0,
    cpuPersona: persona,
    ghostSecretHash: null,
    handleIsGenerated: false,
    ...overrides,
  });
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

export function buildQuestion(marketId: string, overrides: Partial<QuestionRow> = {}): QuestionRow {
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

/** `fingerprints` row (§8.1, WS4-T1/T7). Neutral defaults (0 style axes, empty category shares)
 * so a fixture only needs to override what a test actually cares about (WS5-T1's nemesis-pool
 * style-vector/category-overlap fixtures). */
export function buildFingerprint(
  profileId: string,
  overrides: Partial<FingerprintRow> = {},
): FingerprintRow {
  return {
    profileId,
    resolvedPickCount: 0,
    chalk: 0,
    contrarian: 0,
    timing: 0,
    categoryShares: {},
    computedAt: T0,
    ...overrides,
  };
}

/** `ratings` row (§5.4, §8.3). Schema defaults (1500/350/0.06) apply for any field omitted. */
export function buildRating(profileId: string, overrides: Partial<RatingRow> = {}): RatingRow {
  return {
    profileId,
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

/** A nemesis season (§5.4) — required FK for `nemesis_pairings`. */
export function buildSeason(overrides: Partial<SeasonRow> = {}): SeasonRow {
  return {
    id: uuidv7(),
    kind: 'nemesis',
    startsOn: '2026-07-13',
    endsOn: '2026-10-04',
    name: 'Test Season',
    ...overrides,
  };
}

/**
 * A `nemesis_pairings` row (§5.5, WS4-T7's `ratings:weekly` batch input). Defaults to
 * `status='completed'` with `profileAId` as the winner and `rating_applied_at` unset — the
 * shape the weekly rating batch consumes. Canonical order (a < b by uuid) is the CALLER's
 * responsibility, matching how every other pairing-producing task (WS5) will build these.
 */
export function buildNemesisPairing(
  seasonId: string,
  profileAId: string,
  profileBId: string,
  overrides: Partial<NemesisPairingRow> = {},
): NemesisPairingRow {
  return {
    id: uuidv7(),
    seasonId,
    weekStart: '2026-07-13',
    profileAId,
    profileBId,
    status: 'completed',
    scoreA: 2,
    scoreB: 1,
    edgeA: 0.3,
    edgeB: 0.1,
    winnerProfileId: profileAId,
    verdict: { narrative_line: 'test verdict' },
    isRematch: false,
    ratingAppliedAt: null,
    ...overrides,
  };
}

/** A `duos` row (§5.5). Defaults to `status='active'` with default Glicko values. */
export function buildDuo(
  profileAId: string,
  profileBId: string,
  overrides: Partial<DuoRow> = {},
): DuoRow {
  return {
    id: uuidv7(),
    profileAId,
    profileBId,
    status: 'active',
    tier: 1,
    glickoRating: 1500,
    glickoRd: 350,
    glickoVol: 0.06,
    matchesPlayed: 0,
    ...overrides,
  };
}

/** A `duo_matches` row (§5.5, WS4-T7's `ratings:weekly` batch input for duo team ratings). */
export function buildDuoMatch(
  duoAId: string,
  duoBId: string,
  overrides: Partial<DuoMatchRow> = {},
): DuoMatchRow {
  return {
    id: uuidv7(),
    duoAId,
    duoBId,
    windowStart: '2026-07-14',
    windowEnd: '2026-07-16',
    status: 'completed',
    scoreA: 4,
    scoreB: 2,
    winnerDuoId: duoAId,
    ratingAppliedAt: null,
    ratingSnapshot: null,
    ...overrides,
  };
}

/** A `topic_follows` row (journeys plan §4/§5 WS16-T2). Composite PK (profile, category). */
export function buildTopicFollow(
  profileId: string,
  overrides: Partial<TopicFollowRow> = {},
): TopicFollowRow {
  return {
    profileId,
    category: 'economics',
    createdAt: T0,
    ...overrides,
  };
}

/**
 * A `callouts` row (journeys plan §4/§5 WS20-T3). Defaults to a fresh `pending` challenge with
 * a 24h expiry and no opponent/pairing yet — the shape `acceptCallout` consumes.
 */
export function buildCallout(
  challengerProfileId: string,
  overrides: Partial<CalloutRow> = {},
): CalloutRow {
  const n = nextSeq();
  return {
    id: uuidv7(),
    challengerProfileId,
    opponentProfileId: null,
    tokenHash: `test-token-hash-${n}`,
    status: 'pending',
    expiresAt: new Date(T0.getTime() + 24 * 3600_000),
    pairingId: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** A `companion_artifacts` row (XH-T4). Defaults to a banter artifact with no pairing/season. */
export function buildCompanionArtifact(
  profileId: string,
  overrides: Partial<CompanionArtifactRow> = {},
): CompanionArtifactRow {
  const n = nextSeq();
  return {
    id: uuidv7(),
    kind: 'banter',
    cacheKey: `test-cache-key-${n}`,
    profileId,
    pairingId: null,
    seasonId: null,
    content: { lines: ['test banter line'], model: 'test', promptVersion: 1 },
    createdAt: T0,
    ...overrides,
  };
}

/** A `companion_xtrace_groups` row (XH-T10). `pairingId` must reference an already-inserted
 * `nemesis_pairings` row (FK) — unlike `cacheKey`-style defaults, there is no sensible random
 * default for a foreign key, so it's a required parameter, mirroring `buildCompanionArtifact`'s
 * `profileId`. Defaults `xtraceGroupId` to a fake-but-realistic `grp_...` id. */
export function buildCompanionXtraceGroup(
  pairingId: string,
  overrides: Partial<CompanionXtraceGroupRow> = {},
): CompanionXtraceGroupRow {
  return {
    pairingId,
    xtraceGroupId: 'grp_test',
    createdAt: T0,
    ...overrides,
  };
}
