/**
 * XH-T7 unit tests (docs/xtrace-hackathon-tasks.md) for `@/lib/companion/callout-draft` — target
 * authorization, the cache check, and `generateAndCacheCalloutDraft` (memory scoping, the
 * money-word-safety AC over the real T3 generator pipeline, and the stored row's pinned `drafts`
 * key / null `pairingId`/`seasonId`). Mirrors `companion-banter-lib.test.ts`'s split: `@receipts/db`
 * and `@/lib/callouts-view` are mocked (no real Postgres); `@receipts/companion`'s
 * `pairingGroupId`/`createGenerator` run for real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ReceiptsDb from '@receipts/db';

const mockCompletedPairingIdsBetween = vi.fn();
const mockGetProfileById = vi.fn();
const mockLifetimeRecordBetween = vi.fn();
const mockGetArtifactByCacheKey = vi.fn();
const mockInsertArtifactIdempotent = vi.fn();

vi.mock('@receipts/db', async (importOriginal) => {
  const actual = await importOriginal<typeof ReceiptsDb>();
  return {
    ...actual,
    completedPairingIdsBetween: (...args: unknown[]) => mockCompletedPairingIdsBetween(...args),
    getProfileById: (...args: unknown[]) => mockGetProfileById(...args),
    lifetimeRecordBetween: (...args: unknown[]) => mockLifetimeRecordBetween(...args),
    getArtifactByCacheKey: (...args: unknown[]) => mockGetArtifactByCacheKey(...args),
    insertArtifactIdempotent: (...args: unknown[]) => mockInsertArtifactIdempotent(...args),
  };
});

const mockGetCalloutCandidates = vi.fn();
vi.mock('@/lib/callouts-view', () => ({
  getCalloutCandidates: (...args: unknown[]) => mockGetCalloutCandidates(...args),
}));

const { authorizeDraftTarget, generateAndCacheCalloutDraft, getDraftCacheHit } =
  await import('@/lib/companion/callout-draft');
const { createGenerator } = await import('@receipts/companion');

const CHALLENGER_ID = '018f1e2b-0000-7000-8000-000000000002';
const TARGET_ID = '018f1e2b-0000-7000-8000-000000000003';
const ET_DAY = '2026-07-23';

afterEach(() => {
  vi.clearAllMocks();
});

describe('authorizeDraftTarget', () => {
  it('authorizes on a completed prior pairing without consulting call-out candidates', async () => {
    mockCompletedPairingIdsBetween.mockResolvedValue(['pairing-1']);
    const priorPairingIds = await authorizeDraftTarget({} as never, CHALLENGER_ID, TARGET_ID);
    expect(priorPairingIds).toEqual(['pairing-1']);
    expect(mockGetCalloutCandidates).not.toHaveBeenCalled();
  });

  it('authorizes a current-week rival with no completed pairing yet, via call-out candidates', async () => {
    mockCompletedPairingIdsBetween.mockResolvedValue([]);
    mockGetCalloutCandidates.mockResolvedValue([
      { profileId: TARGET_ID, handle: 'Otter #9001', slug: 'otter-9001' },
    ]);
    const priorPairingIds = await authorizeDraftTarget({} as never, CHALLENGER_ID, TARGET_ID);
    expect(priorPairingIds).toEqual([]);
  });

  it("rejects a stranger — neither a completed pairing nor a candidate (the untruncated check, pinning it against getCalloutCandidates' one-page cap)", async () => {
    mockCompletedPairingIdsBetween.mockResolvedValue([]);
    mockGetCalloutCandidates.mockResolvedValue([]);
    await expect(authorizeDraftTarget({} as never, CHALLENGER_ID, TARGET_ID)).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
  });
});

describe('getDraftCacheHit', () => {
  it('returns the stored drafts on a hit', async () => {
    mockGetArtifactByCacheKey.mockResolvedValue({ content: { drafts: ['cached'] } });
    const drafts = await getDraftCacheHit({} as never, CHALLENGER_ID, TARGET_ID, ET_DAY);
    expect(drafts).toEqual(['cached']);
  });

  it('returns null on a miss', async () => {
    mockGetArtifactByCacheKey.mockResolvedValue(null);
    const drafts = await getDraftCacheHit({} as never, CHALLENGER_ID, TARGET_ID, ET_DAY);
    expect(drafts).toBeNull();
  });
});

function defaultDbMocks(): void {
  mockGetProfileById.mockImplementation(async (_db: unknown, id: string) => ({
    id,
    handle: id === CHALLENGER_ID ? 'Fox #1' : 'Otter #2',
  }));
  mockLifetimeRecordBetween.mockResolvedValue({ wins: 2, losses: 1, draws: 0 });
}

describe('generateAndCacheCalloutDraft', () => {
  it('throws COMPANION_UNAVAILABLE immediately when the generator is unconfigured, without any DB work', async () => {
    await expect(
      generateAndCacheCalloutDraft({} as never, null, null, CHALLENGER_ID, TARGET_ID, [], ET_DAY),
    ).rejects.toMatchObject({ code: 'COMPANION_UNAVAILABLE' });
    expect(mockGetProfileById).not.toHaveBeenCalled();
  });

  it('throws COMPANION_UNAVAILABLE when the generator produces no drafts, without storing anything', async () => {
    defaultDbMocks();
    const generator = {
      banter: vi.fn(),
      calloutDrafts: vi.fn().mockResolvedValue(null),
      seasonRecap: vi.fn(),
    };
    await expect(
      generateAndCacheCalloutDraft(
        {} as never,
        null,
        generator,
        CHALLENGER_ID,
        TARGET_ID,
        [],
        ET_DAY,
      ),
    ).rejects.toMatchObject({ code: 'COMPANION_UNAVAILABLE' });
    expect(mockInsertArtifactIdempotent).not.toHaveBeenCalled();
  });

  it('stores the artifact with the pinned "callout_draft" kind, drafts key, and null pairingId/seasonId', async () => {
    defaultDbMocks();
    const generator = {
      banter: vi.fn(),
      calloutDrafts: vi.fn().mockResolvedValue(['line one']),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockImplementation(
      async (_db: unknown, row: { content: { drafts: string[] } }) => ({
        content: row.content,
        createdAt: new Date('2026-07-23T00:00:00Z'),
      }),
    );

    await generateAndCacheCalloutDraft(
      {} as never,
      null,
      generator,
      CHALLENGER_ID,
      TARGET_ID,
      [],
      ET_DAY,
    );

    expect(mockInsertArtifactIdempotent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        kind: 'callout_draft',
        profileId: CHALLENGER_ID,
        pairingId: null,
        seasonId: null,
        content: expect.objectContaining({ drafts: ['line one'] }),
      }),
    );
  });

  it('returns the STORED artifact drafts, not the freshly-generated ones (concurrent double-generate)', async () => {
    defaultDbMocks();
    const generator = {
      banter: vi.fn(),
      calloutDrafts: vi.fn().mockResolvedValue(['freshly generated']),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockResolvedValue({
      content: {
        drafts: ['already stored by another concurrent caller'],
        model: 'test',
        promptVersion: 1,
      },
      createdAt: new Date(),
    });

    const drafts = await generateAndCacheCalloutDraft(
      {} as never,
      null,
      generator,
      CHALLENGER_ID,
      TARGET_ID,
      [],
      ET_DAY,
    );
    expect(drafts).toEqual(['already stored by another concurrent caller']);
  });
});

describe('generateAndCacheCalloutDraft — memory scoping (XH-T7 AC)', () => {
  it('concatenates group results before user results, de-duped by memory id, and skips the group search with no prior pairings', async () => {
    defaultDbMocks();
    const priorPairingIds = ['pairing-1', 'pairing-2'];
    const searchCalls: unknown[] = [];
    const xtrace = {
      async ingest() {
        return true;
      },
      async createGroup() {
        return 'grp_test';
      },
      async search(args: { groupIds?: string[]; userId?: string }) {
        searchCalls.push(args);
        if (args.groupIds) {
          return [
            { id: 'mem-group-1', type: 'fact', text: 'group memory one', score: null },
            {
              id: 'mem-shared',
              type: 'fact',
              text: 'shared (should win as group copy)',
              score: null,
            },
          ];
        }
        return [
          { id: 'mem-shared', type: 'fact', text: 'shared (user copy, deduped away)', score: null },
          { id: 'mem-user-1', type: 'fact', text: 'user memory one', score: null },
        ];
      },
    };
    const generator = {
      banter: vi.fn(),
      calloutDrafts: vi.fn().mockResolvedValue(['line']),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockResolvedValue({
      content: { drafts: ['line'], model: 'test', promptVersion: 1 },
      createdAt: new Date(),
    });

    await generateAndCacheCalloutDraft(
      {} as never,
      xtrace,
      generator,
      CHALLENGER_ID,
      TARGET_ID,
      priorPairingIds,
      ET_DAY,
    );

    expect(searchCalls).toHaveLength(2);
    const groupCall = searchCalls.find((c) => (c as { groupIds?: string[] }).groupIds) as {
      groupIds: string[];
      query: string;
    };
    expect(groupCall.groupIds).toEqual(['pairing:pairing-1', 'pairing:pairing-2']);
    expect(groupCall.query).toBe('Otter #2 rivalry trash talk grudges history');
    const userCall = searchCalls.find((c) => (c as { userId?: string }).userId) as {
      userId: string;
    };
    expect(userCall.userId).toBe(CHALLENGER_ID);

    expect(generator.calloutDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: ['group memory one', 'shared (should win as group copy)', 'user memory one'],
      }),
    );
  });

  it('skips the group-scoped search entirely with no prior pairings (only the user-scoped call runs)', async () => {
    defaultDbMocks();
    const searchCalls: unknown[] = [];
    const xtrace = {
      async ingest() {
        return true;
      },
      async createGroup() {
        return 'grp_test';
      },
      async search(args: unknown) {
        searchCalls.push(args);
        return [];
      },
    };
    const generator = {
      banter: vi.fn(),
      calloutDrafts: vi.fn().mockResolvedValue(['line']),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockResolvedValue({
      content: { drafts: ['line'], model: 'test', promptVersion: 1 },
      createdAt: new Date(),
    });

    await generateAndCacheCalloutDraft(
      {} as never,
      xtrace,
      generator,
      CHALLENGER_ID,
      TARGET_ID,
      [],
      ET_DAY,
    );
    expect(searchCalls).toHaveLength(1);
  });

  it('MEMORY degrades to [] with a null xTrace client, without skipping generation', async () => {
    defaultDbMocks();
    const generator = {
      banter: vi.fn(),
      calloutDrafts: vi.fn().mockResolvedValue(['line']),
      seasonRecap: vi.fn(),
    };
    mockInsertArtifactIdempotent.mockResolvedValue({
      content: { drafts: ['line'], model: 'test', promptVersion: 1 },
      createdAt: new Date(),
    });

    const drafts = await generateAndCacheCalloutDraft(
      {} as never,
      null,
      generator,
      CHALLENGER_ID,
      TARGET_ID,
      ['pairing-1'],
      ET_DAY,
    );
    expect(drafts).not.toBeNull();
    expect(generator.calloutDrafts).toHaveBeenCalledWith(expect.objectContaining({ memory: [] }));
  });
});

describe('generateAndCacheCalloutDraft — money-word safety (XH-T7 AC, real T3 pipeline)', () => {
  it("drops a money-word line from the real Generator's output before it reaches the response", async () => {
    defaultDbMocks();
    const fakeAnthropic = {
      messages: {
        parse: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          parsed_output: { lines: ['a clean challenge line', 'stake your reputation on this'] },
        }),
      },
    };
    const generator = createGenerator(fakeAnthropic as never);
    mockInsertArtifactIdempotent.mockImplementation(
      async (_db: unknown, row: { content: { drafts: string[] } }) => ({
        content: row.content,
        createdAt: new Date(),
      }),
    );

    const drafts = await generateAndCacheCalloutDraft(
      {} as never,
      null,
      generator,
      CHALLENGER_ID,
      TARGET_ID,
      [],
      ET_DAY,
    );

    expect(drafts).toEqual(['a clean challenge line']);
    expect(drafts.join(' ')).not.toMatch(/\bstake\b/i);
  });
});
