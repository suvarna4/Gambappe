/**
 * Unit tests for the (now rematch-request-only) nemesis mock backend. `getCurrentPairing`,
 * `getPairingById`, `getProfileRef`, and `getNemesisHistory` were removed from `mock-api.ts`
 * by WS5-T4 (real implementations now live in `apps/web/lib/nemesis/service.ts`, exercised by
 * `apps/web/test/integration/nemesis-matchup-api.test.ts` against real Postgres) — see
 * `mock-api.ts`'s file header for the full explanation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@receipts/core';
import {
  __resetRematchRequestsForTests,
  acceptRematchRequest,
  createRematchRequest,
  declineRematchRequest,
  getIncomingRematchRequest,
  getOutgoingRematchRequest,
} from '../../lib/nemesis/mock-api';
import { PAST_NEMESIS_DRAW, PAST_NEMESIS_LOSS, PAST_NEMESIS_WIN, VIEWER } from '../../lib/nemesis/mock-fixtures';

beforeEach(() => {
  __resetRematchRequestsForTests();
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
