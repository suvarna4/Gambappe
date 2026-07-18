import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@receipts/core';
import {
  __resetRematchRequestsForTests,
  acceptRematchRequest,
  createRematchRequest,
  declineRematchRequest,
  getCurrentPairing,
  getIncomingRematchRequest,
  getNemesisHistory,
  getOutgoingRematchRequest,
  getPairingById,
  getProfileRef,
} from '../../lib/nemesis/mock-api';
import {
  CURRENT_OPPONENT,
  CURRENT_PAIRING_ID,
  PAST_NEMESIS_DRAW,
  PAST_NEMESIS_LOSS,
  PAST_NEMESIS_WIN,
  PAST_PAIRING_DRAW_ID,
  PAST_PAIRING_LOSS_ID,
  PAST_PAIRING_WIN_ID,
  VIEWER,
} from '../../lib/nemesis/mock-fixtures';

beforeEach(() => {
  __resetRematchRequestsForTests();
});

describe('getCurrentPairing', () => {
  it("returns the viewer's active pairing with a masked-then-revealed scoreboard", () => {
    const { pairing } = getCurrentPairing(VIEWER.profile_id);
    expect(pairing).not.toBeNull();
    expect(pairing?.status).toBe('active');
    expect(pairing?.a.profile_id).toBe(VIEWER.profile_id);
    expect(pairing?.b.profile_id).toBe(CURRENT_OPPONENT.profile_id);
    // Rows 1-3 locked (revealed), row 4+5 not yet locked (masked) — see mock-fixtures.ts.
    const rows = pairing!.scoreboard;
    expect(rows).toHaveLength(5);
    expect(rows[0]!.a).not.toBeNull();
    expect(rows[1]!.a).not.toBeNull();
    expect(rows[2]!.a).not.toBeNull();
    expect(rows[3]!.a).toBeNull();
    expect(rows[3]!.b).toBeNull();
    expect(rows[4]!.a).toBeNull();
    expect(rows[4]!.b).toBeNull();
  });

  it('returns null for anyone who is not the mock viewer', () => {
    const { pairing } = getCurrentPairing('someone-else');
    expect(pairing).toBeNull();
  });
});

describe('getPairingById', () => {
  it('returns the current pairing by id (public shape, no auth check)', () => {
    const pairing = getPairingById(CURRENT_PAIRING_ID);
    expect(pairing?.id).toBe(CURRENT_PAIRING_ID);
  });

  it('returns a completed past pairing with a win verdict', () => {
    const pairing = getPairingById(PAST_PAIRING_WIN_ID);
    expect(pairing?.status).toBe('completed');
    expect(pairing?.winner_profile_id).toBe(VIEWER.profile_id);
    expect(pairing?.score).toEqual({ a: 3, b: 1 });
  });

  it('returns a completed past pairing with a loss verdict', () => {
    const pairing = getPairingById(PAST_PAIRING_LOSS_ID);
    expect(pairing?.status).toBe('completed');
    expect(pairing?.winner_profile_id).toBe(PAST_NEMESIS_LOSS.profile_id);
    expect(pairing?.score).toEqual({ a: 1, b: 3 });
  });

  it('returns a completed past pairing with a draw (no winner)', () => {
    const pairing = getPairingById(PAST_PAIRING_DRAW_ID);
    expect(pairing?.status).toBe('completed');
    expect(pairing?.winner_profile_id).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(getPairingById('00000000-0000-4000-8000-999999999999')).toBeNull();
  });
});

describe('getProfileRef', () => {
  it('returns rating info for a known slug', () => {
    const ref = getProfileRef(CURRENT_OPPONENT.slug);
    expect(ref?.handle).toBe(CURRENT_OPPONENT.handle);
    expect(ref?.rating?.glicko_rating).toBe(CURRENT_OPPONENT.rating.glicko_rating);
  });

  it('returns null for an unknown slug', () => {
    expect(getProfileRef('nobody-0000')).toBeNull();
  });
});

describe('getNemesisHistory', () => {
  it("returns the viewer's history entries", () => {
    const { data } = getNemesisHistory(VIEWER.profile_id);
    expect(data).toHaveLength(3);
    expect(data.map((e) => e.outcome).sort()).toEqual(['draw', 'loss', 'win']);
  });

  it('returns empty for anyone else', () => {
    const { data } = getNemesisHistory('someone-else');
    expect(data).toHaveLength(0);
  });
});

describe('rematch requests (§8.4 step 0: create = requester consent, accept = target consent = mutual)', () => {
  it('lets the viewer request a rematch against a past nemesis', () => {
    const { request } = createRematchRequest(VIEWER.profile_id, PAST_NEMESIS_WIN.profile_id);
    expect(request.status).toBe('open');
    expect(request.requester_profile_id).toBe(VIEWER.profile_id);
    expect(request.target_profile_id).toBe(PAST_NEMESIS_WIN.profile_id);
  });

  it('rejects a rematch request against someone who was never a nemesis this season', () => {
    expect(() => createRematchRequest(VIEWER.profile_id, 'not-a-real-profile')).toThrow(ApiError);
  });

  it('rejects a self-rematch', () => {
    expect(() => createRematchRequest(VIEWER.profile_id, VIEWER.profile_id)).toThrow(ApiError);
  });

  it('is idempotent — re-requesting while one is already open returns the same request', () => {
    const first = createRematchRequest(VIEWER.profile_id, PAST_NEMESIS_WIN.profile_id);
    const second = createRematchRequest(VIEWER.profile_id, PAST_NEMESIS_WIN.profile_id);
    expect(second.request.id).toBe(first.request.id);
  });

  it('only the target may accept, moving status to "accepted"', () => {
    const { request } = createRematchRequest(VIEWER.profile_id, PAST_NEMESIS_WIN.profile_id);
    expect(() => acceptRematchRequest(request.id, VIEWER.profile_id)).toThrow(ApiError); // requester can't self-accept
    const { request: accepted } = acceptRematchRequest(request.id, PAST_NEMESIS_WIN.profile_id);
    expect(accepted.status).toBe('accepted');
  });

  it('only the target may decline, moving status to "declined"', () => {
    const { request } = createRematchRequest(VIEWER.profile_id, PAST_NEMESIS_WIN.profile_id);
    const { request: declined } = declineRematchRequest(request.id, PAST_NEMESIS_WIN.profile_id);
    expect(declined.status).toBe('declined');
  });

  it('rejects acting on an already-resolved request', () => {
    const { request } = createRematchRequest(VIEWER.profile_id, PAST_NEMESIS_WIN.profile_id);
    acceptRematchRequest(request.id, PAST_NEMESIS_WIN.profile_id);
    expect(() => acceptRematchRequest(request.id, PAST_NEMESIS_WIN.profile_id)).toThrow(ApiError);
  });

  it('rejects an unknown request id', () => {
    expect(() =>
      acceptRematchRequest('00000000-0000-4000-8000-999999999999', VIEWER.profile_id),
    ).toThrow(ApiError);
  });

  it('exposes the seeded incoming request (Otter -> viewer) via the mock-only discovery helper', () => {
    const incoming = getIncomingRematchRequest(VIEWER.profile_id);
    expect(incoming?.requester_profile_id).toBe(PAST_NEMESIS_LOSS.profile_id);
    expect(incoming?.status).toBe('open');
  });

  it('mock-only outgoing lookup returns the most recent request to a target', () => {
    expect(getOutgoingRematchRequest(VIEWER.profile_id, PAST_NEMESIS_DRAW.profile_id)).toBeNull();
    const { request } = createRematchRequest(VIEWER.profile_id, PAST_NEMESIS_DRAW.profile_id);
    const outgoing = getOutgoingRematchRequest(VIEWER.profile_id, PAST_NEMESIS_DRAW.profile_id);
    expect(outgoing?.id).toBe(request.id);
  });
});
