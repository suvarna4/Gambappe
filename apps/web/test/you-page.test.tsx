/**
 * XH-T8 unit tests (docs/xtrace-hackathon-tasks.md) for `app/you/page.tsx`'s own wiring — the
 * `isFlagEnabled('season_wrapped')` gate and the `recapArtifact?.content.recap ?? null` mapping
 * from the stored artifact into `YouRoomClaimed`'s `recap` prop. `you-room.test.tsx` only exercises
 * `YouRoomClaimed` with a hand-built `recap` prop; nothing there calls this page function, so a
 * regression in the gate or the mapping (e.g. an inverted flag check, or dropping `.content.recap`)
 * would pass every other test in the suite. This file closes that gap by calling the page's
 * default export directly (an async Server Component is just an async function) and inspecting
 * the RETURNED ELEMENT's props — no render/DOM needed, mirroring this repo's route-handler-test
 * convention (mock deps, call the real function, assert on what it returns).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const mockResolveViewerIdentity = vi.fn();
vi.mock('@/lib/identity-request', () => ({
  resolveViewerIdentity: () => mockResolveViewerIdentity(),
}));

vi.mock('@/lib/stores', () => ({
  getDb: () => ({}),
}));

const mockGetProfilePageModel = vi.fn();
vi.mock('@/lib/profile-page', () => ({
  getProfilePageModel: (...args: unknown[]) => mockGetProfilePageModel(...args),
}));

const mockLatestRecapForProfile = vi.fn();
const mockGetFollows = vi.fn();
vi.mock('@receipts/db', () => ({
  latestRecapForProfile: (...args: unknown[]) => mockLatestRecapForProfile(...args),
  getFollows: (...args: unknown[]) => mockGetFollows(...args),
}));

const { default: YouPage } = await import('@/app/you/page');
const { YouRoomClaimed, YouRoomGhost } = await import('@/components/profile/YouRoom');

const PROFILE_ID = '018f1e2b-0000-7000-8000-000000000002';

const FAKE_MODEL = {
  profile: {
    handle: 'ACE#1234',
    slug: 'ace-1234',
    currentStreak: 5,
    bestStreak: 9,
    currentWinStreak: 3,
    bestWinStreak: 7,
    freezeBank: 2,
  },
  stats: {
    rating: { accuracy_percentile: 88, glicko_rating: 1500 },
    wallet: { verified: false },
    nemesisSummary: { wins: 4, losses: 2, draws: 1 },
    badges: [],
    fingerprint: { category_shares: {} },
    graveyard: null,
  },
  picks: [],
  nextCursor: null,
};

function claimedIdentity() {
  return { kind: 'claimed' as const, profile: { id: PROFILE_ID }, userId: 'u1' };
}

describe('YouPage — season-wrapped recap gate + mapping (XH-T8)', () => {
  const originalFlag = process.env.FLAG_SEASON_WRAPPED;
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.FLAG_SEASON_WRAPPED;
    else process.env.FLAG_SEASON_WRAPPED = originalFlag;
    vi.clearAllMocks();
  });

  it('never calls latestRecapForProfile when the flag is off, and passes recap={null}', async () => {
    process.env.FLAG_SEASON_WRAPPED = 'false';
    mockResolveViewerIdentity.mockResolvedValue(claimedIdentity());
    mockGetProfilePageModel.mockResolvedValue(FAKE_MODEL);

    const element = (await YouPage()) as ReactElement<{ recap: unknown }>;
    expect(element.type).toBe(YouRoomClaimed);
    expect(element.props.recap).toBeNull();
    expect(mockLatestRecapForProfile).not.toHaveBeenCalled();
  });

  it('calls latestRecapForProfile when the flag is on, and passes recap={null} when no artifact exists yet', async () => {
    process.env.FLAG_SEASON_WRAPPED = 'true';
    mockResolveViewerIdentity.mockResolvedValue(claimedIdentity());
    mockGetProfilePageModel.mockResolvedValue(FAKE_MODEL);
    mockLatestRecapForProfile.mockResolvedValue(null);

    const element = (await YouPage()) as ReactElement<{ recap: unknown }>;
    expect(mockLatestRecapForProfile).toHaveBeenCalledWith({}, PROFILE_ID);
    expect(element.props.recap).toBeNull();
  });

  it("maps the stored artifact's content.recap into the recap prop when the flag is on and an artifact exists", async () => {
    process.env.FLAG_SEASON_WRAPPED = 'true';
    mockResolveViewerIdentity.mockResolvedValue(claimedIdentity());
    mockGetProfilePageModel.mockResolvedValue(FAKE_MODEL);
    mockLatestRecapForProfile.mockResolvedValue({
      content: {
        recap: { title: 'ACE#1234 season recap', paragraphs: ['para one', 'para two'] },
        model: 'test',
        promptVersion: 1,
      },
    });

    const element = (await YouPage()) as ReactElement<{
      recap: { title: string; paragraphs: string[] } | null;
    }>;
    expect(element.props.recap).toEqual({
      title: 'ACE#1234 season recap',
      paragraphs: ['para one', 'para two'],
    });
  });

  it('renders the ghost room (no recap prop at all) for a non-claimed viewer, regardless of the flag', async () => {
    process.env.FLAG_SEASON_WRAPPED = 'true';
    mockResolveViewerIdentity.mockResolvedValue({ kind: 'anonymous' });

    const element = await YouPage();
    expect(element.type).toBe(YouRoomGhost);
    expect(mockLatestRecapForProfile).not.toHaveBeenCalled();
    expect(mockGetProfilePageModel).not.toHaveBeenCalled();
  });
});
