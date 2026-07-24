/**
 * XH-T6 unit tests (docs/xtrace-hackathon-tasks.md) for `generateAndCacheBanter`
 * (`@/lib/companion/banter`) — the actual generation/caching logic, as opposed to
 * `companion-banter-route.test.ts`'s auth/cache/rate-limit orchestration (which mocks this
 * module entirely). `@receipts/db` is mocked here so no real Postgres is needed; `@receipts/
 * engine`'s `scoreNemesisWeek` and `@receipts/companion`'s `pairingGroupId`/`createGenerator`
 * run for real (pure functions / the real T3 pipeline over a fake Anthropic client).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { XtraceClient } from '@receipts/companion';
import type * as ReceiptsDb from '@receipts/db';

const mockGetProfileById = vi.fn();
const mockLifetimeRecordBetween = vi.fn();
const mockGetFullPairingSharedQuestionPicks = vi.fn();
const mockMostRecentCompletedPairingBetween = vi.fn();
const mockCompletedPairingIdsBetween = vi.fn();
const mockInsertArtifactIdempotent = vi.fn();

vi.mock('@receipts/db', async (importOriginal) => {
  const actual = await importOriginal<typeof ReceiptsDb>();
  return {
    ...actual,
    getProfileById: (...args: unknown[]) => mockGetProfileById(...args),
    lifetimeRecordBetween: (...args: unknown[]) => mockLifetimeRecordBetween(...args),
    getFullPairingSharedQuestionPicks: (...args: unknown[]) =>
      mockGetFullPairingSharedQuestionPicks(...args),
    mostRecentCompletedPairingBetween: (...args: unknown[]) =>
      mockMostRecentCompletedPairingBetween(...args),
    completedPairingIdsBetween: (...args: unknown[]) => mockCompletedPairingIdsBetween(...args),
    insertArtifactIdempotent: (...args: unknown[]) => mockInsertArtifactIdempotent(...args),
  };
});

const { generateAndCacheBanter } = await import('@/lib/companion/banter');
const { createGenerator } = await import('@receipts/companion');

const VIEWER_ID = '018f1e2b-0000-7000-8000-000000000002';
const OPPONENT_ID = '018f1e2b-0000-7000-8000-000000000003';
const PAIRING_ID = '018f1e2b-0000-7000-8000-000000000010';
const ET_DAY = '2026-07-13';
const AT = new Date('2026-07-13T12:00:00Z');

const PAIRING = {
  id: PAIRING_ID,
  seasonId: '018f1e2b-0000-7000-8000-000000000011',
  weekStart: '2026-07-13',
  profileAId: VIEWER_ID,
  profileBId: OPPONENT_ID,
  status: 'active' as const,
  scoreA: 0,
  scoreB: 0,
  edgeA: 0,
  edgeB: 0,
  winnerProfileId: null,
  verdict: null,
  isRematch: false,
  ratingAppliedAt: null,
  createdAt: AT,
  updatedAt: AT,
};

function fakeXtrace(
  searchResults: { id: string; type: string; text: string; score: number | null }[] = [],
): {
  client: XtraceClient;
  searchCalls: unknown[];
} {
  const searchCalls: unknown[] = [];
  return {
    searchCalls,
    client: {
      async ingest() {
        return true;
      },
      async search(args) {
        searchCalls.push(args);
        return searchResults;
      },
      async createGroup() {
        return 'grp_test';
      },
    },
  };
}

function defaultDbMocks(): void {
  mockGetProfileById.mockImplementation(async (_db: unknown, id: string) => ({
    id,
    handle: id === VIEWER_ID ? 'Fox #1' : 'Otter #2',
  }));
  mockLifetimeRecordBetween.mockResolvedValue({ wins: 1, losses: 1, draws: 0 });
  mockGetFullPairingSharedQuestionPicks.mockResolvedValue([]);
  mockMostRecentCompletedPairingBetween.mockResolvedValue(null);
  mockCompletedPairingIdsBetween.mockResolvedValue([]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('generateAndCacheBanter', () => {
  it('returns null immediately when the generator is unconfigured, without any DB work', async () => {
    const result = await generateAndCacheBanter(
      {} as never,
      null,
      null,
      PAIRING,
      VIEWER_ID,
      ET_DAY,
      AT,
    );
    expect(result).toBeNull();
    expect(mockGetProfileById).not.toHaveBeenCalled();
  });

  it('returns the STORED artifact lines, not the freshly-generated ones (concurrent double-generate)', async () => {
    defaultDbMocks();
    const { client: xtrace } = fakeXtrace();
    const generator = {
      banter: vi.fn().mockResolvedValue(['freshly generated line']),
      calloutDrafts: vi.fn(),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockResolvedValue({
      content: {
        lines: ['line another concurrent caller already stored'],
        model: 'test',
        promptVersion: 1,
      },
      createdAt: new Date('2026-07-13T12:05:00Z'),
    });

    const result = await generateAndCacheBanter(
      {} as never,
      xtrace,
      generator,
      PAIRING,
      VIEWER_ID,
      ET_DAY,
      AT,
    );
    expect(result).toEqual({
      lines: ['line another concurrent caller already stored'],
      generated_at: '2026-07-13T12:05:00.000Z',
    });
  });

  it('returns null when the generator produces no lines', async () => {
    defaultDbMocks();
    const { client: xtrace } = fakeXtrace();
    const generator = {
      banter: vi.fn().mockResolvedValue(null),
      calloutDrafts: vi.fn(),
      seasonRecap: vi.fn(),
    };

    const result = await generateAndCacheBanter(
      {} as never,
      xtrace,
      generator,
      PAIRING,
      VIEWER_ID,
      ET_DAY,
      AT,
    );
    expect(result).toBeNull();
    expect(mockInsertArtifactIdempotent).not.toHaveBeenCalled();
  });
});

describe('generateAndCacheBanter — memory scoping (XH-T6 AC)', () => {
  it("passes groupIds covering the prior completed pairings' groups as well as the current pairing's", async () => {
    defaultDbMocks();
    const priorPairingId = '018f1e2b-0000-7000-8000-000000000099';
    mockCompletedPairingIdsBetween.mockResolvedValue([priorPairingId]);
    const { client: xtrace, searchCalls } = fakeXtrace();
    const generator = {
      banter: vi.fn().mockResolvedValue(['line']),
      calloutDrafts: vi.fn(),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockResolvedValue({
      content: { lines: ['line'], model: 'test', promptVersion: 1 },
      createdAt: AT,
    });

    await generateAndCacheBanter({} as never, xtrace, generator, PAIRING, VIEWER_ID, ET_DAY, AT);

    expect(searchCalls).toHaveLength(1);
    const call = searchCalls[0] as { groupIds: string[] };
    expect(call.groupIds).toContain(`pairing:${PAIRING_ID}`);
    expect(call.groupIds).toContain(`pairing:${priorPairingId}`);
  });

  it('MEMORY degrades to [] with a null xTrace client, without skipping generation', async () => {
    defaultDbMocks();
    const generator = {
      banter: vi.fn().mockResolvedValue(['line']),
      calloutDrafts: vi.fn(),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockResolvedValue({
      content: { lines: ['line'], model: 'test', promptVersion: 1 },
      createdAt: AT,
    });

    const result = await generateAndCacheBanter(
      {} as never,
      null,
      generator,
      PAIRING,
      VIEWER_ID,
      ET_DAY,
      AT,
    );
    expect(result).not.toBeNull();
    expect(generator.banter).toHaveBeenCalledWith(expect.objectContaining({ memory: [] }));
  });
});

describe('generateAndCacheBanter — money-word safety (XH-T6 AC, real T3 pipeline)', () => {
  it("drops a money-word line from the real Generator's output before it reaches the response", async () => {
    defaultDbMocks();
    const { client: xtrace } = fakeXtrace();
    const fakeAnthropic = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          parsed_output: { lines: ['a clean rivalry line', 'no more betting against me'] },
        }),
      },
    };
    const generator = createGenerator(fakeAnthropic as never);
    mockInsertArtifactIdempotent.mockImplementation(
      async (_db: unknown, row: { content: { lines: string[] } }) => ({
        content: row.content,
        createdAt: AT,
      }),
    );

    const result = await generateAndCacheBanter(
      {} as never,
      xtrace,
      generator,
      PAIRING,
      VIEWER_ID,
      ET_DAY,
      AT,
    );

    expect(result?.lines).toEqual(['a clean rivalry line']);
    expect(result?.lines.join(' ')).not.toMatch(/\bbet\b|\bbetting\b/i);
  });
});
