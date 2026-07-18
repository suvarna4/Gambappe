/**
 * WS0-T2 AC: every §9.2 endpoint has request + response schemas exported.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_CONTRACT } from '../src/schemas/registry.js';

/** The §9.2 endpoint table, verbatim (all rows, including per-context thread/post variants). */
const SPEC_ENDPOINTS = [
  'GET /questions/today',
  'GET /questions/:slug',
  'GET /questions/:slug/reveal',
  'POST /questions/:id/picks',
  'DELETE /picks/:id',
  'GET /questions/:slug/thread',
  'GET /pairings/:id/thread',
  'GET /duo-matches/:id/thread',
  'POST /questions/:id/posts',
  'POST /pairings/:id/posts',
  'POST /duo-matches/:id/posts',
  'POST /reactions',
  'GET /profiles/:slug',
  'GET /profiles/:slug/picks',
  'GET /me',
  'PATCH /me/settings',
  'PATCH /me/handle',
  'POST /claim',
  'DELETE /me',
  'GET /placement',
  'POST /placement/answers',
  'GET /pairings/current',
  'GET /pairings/:id',
  'GET /me/nemesis-history',
  'POST /rematch-requests',
  'POST /rematch-requests/:id/accept',
  'POST /rematch-requests/:id/decline',
  'POST /duo/queue',
  'DELETE /duo/queue',
  'GET /duo/current',
  'GET /duos/:id',
  'GET /duo/ladder',
  'POST /duos/:id/disband',
  'POST /blocks',
  'DELETE /blocks/:blocked_profile_id',
  'POST /reports',
  'POST /wallet/nonce',
  'POST /wallet/verify',
  'DELETE /wallet',
  'POST /push/subscribe',
  'DELETE /push/subscribe',
  'POST /events',
  'GET /leaderboards/weekly',
  'POST /internal/revalidate',
] as const;

describe('API contract registry (§9.2)', () => {
  it('covers every spec endpoint, with no extras', () => {
    const registered = Object.keys(API_CONTRACT).sort();
    expect(registered).toEqual([...SPEC_ENDPOINTS].sort());
  });

  it.each(SPEC_ENDPOINTS)('%s has zod request + response schemas', (endpoint) => {
    const contract = API_CONTRACT[endpoint];
    expect(contract.request).toBeInstanceOf(z.ZodType);
    expect(contract.response).toBeInstanceOf(z.ZodType);
  });
});
