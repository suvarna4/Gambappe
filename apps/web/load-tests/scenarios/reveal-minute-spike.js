/**
 * WS14-T2 load test — reveal-minute concurrency spike (design doc §17.1: "reveal-minute API
 * spike on `/reveal` (must not touch venue APIs at all)"; WS14-T2 row: "a reveal-minute
 * concurrency scenario against `GET /me` + `GET /questions/:slug/reveal` at 500 concurrent
 * clients with jitter disabled (worst case) — DB connection pool must hold").
 *
 * §10.2 describes the real client behavior this simulates: at T-0 every client applies a random
 * 0-20s jitter before re-fetching, specifically so the synchronized reveal moment doesn't
 * become a synchronized stampede. This scenario deliberately DISABLES that jitter — every VU
 * fires both requests as close to simultaneously as k6 can manage — because that's the
 * documented worst case the DB pool has to survive, not the common case.
 *
 * Each VU is a distinct pre-seeded ghost (`apps/web/load-tests/seed.ts`), presenting its own
 * real `rcpt_gid` cookie — this is real per-viewer traffic (`GET /me` resolves identity, `GET
 * /reveal` returns that viewer's own result block), not N requests replaying one cookie.
 *
 * "Must not touch venue APIs at all" is asserted two ways: (1) statically — see this task's PR
 * description for the grep proof that `apps/web/lib/reveal-payload.ts` and `GET /me`'s call
 * path import only `@receipts/db`/`@receipts/core`/`ioredis`, never `@receipts/venues` or
 * `defaultVenueAdapters`; (2) operationally — this scenario is run with no venue base URLs
 * configured (`KALSHI_API_BASE`/`POLYMARKET_*_BASE` unset, `.env.example` default), so any
 * accidental venue call would fail loudly (thrown error -> 5xx) rather than silently succeeding,
 * and `five_xx_rate` below would catch it.
 *
 * Usage:
 *   LOAD_TEST_BASE_URL=http://localhost:39142 k6 run scenarios/reveal-minute-spike.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.LOAD_TEST_BASE_URL || 'http://localhost:3000';
const fixture = JSON.parse(
  open(__ENV.LOAD_TEST_FIXTURE_PATH || '../.fixtures/load-test-fixture.json'),
);

// WS14-T2 AC, verbatim: "pool exhaustion never returns 5xx to >0.5% of the spike" — tracked
// distinctly from generic http_req_failed, since 4xx (which we don't expect here, but which
// http_req_failed would also flag) is not what the AC is gating on.
const fiveXxRate = new Rate('five_xx_rate');

export const options = {
  scenarios: {
    reveal_minute_spike: {
      executor: 'per-vu-iterations',
      // WS14-T2 row, verbatim: "500 concurrent clients". Driven by the fixture (seed.ts's
      // LOAD_TEST_REVEAL_VUS, default 500) so the scenario and the seeded ghost count can never
      // silently drift apart.
      vus: fixture.ghosts.length,
      iterations: 1,
      // per-vu-iterations starts every VU immediately (no ramp) — this IS the "jitter disabled,
      // worst case" synchronized burst the AC calls for.
      maxDuration: '2m',
    },
  },
  thresholds: {
    five_xx_rate: ['rate<0.005'],
    // Not pinned by the design doc for these two endpoints (§17.1 only gives an explicit p95
    // for the spectator page). SPEC-GAP(WS14-T2): engineering-chosen bar for an uncacheable
    // DB+Redis-backed read under a synchronized 500-VU spike — see PR description.
    'http_req_duration{endpoint:me}': ['p(95)<1000'],
    'http_req_duration{endpoint:reveal}': ['p(95)<1000'],
    checks: ['rate>0.99'],
  },
};

export default function revealMinuteSpike() {
  const ghost = fixture.ghosts[(__VU - 1) % fixture.ghosts.length];
  const headers = { Cookie: ghost.cookie };

  const meRes = http.get(`${BASE_URL}/api/v1/me`, { headers, tags: { endpoint: 'me' } });
  fiveXxRate.add(meRes.status >= 500);
  check(meRes, { 'GET /me: status is 200': (r) => r.status === 200 });

  const revealRes = http.get(`${BASE_URL}/api/v1/questions/${fixture.revealQuestionSlug}/reveal`, {
    headers,
    tags: { endpoint: 'reveal' },
  });
  fiveXxRate.add(revealRes.status >= 500);
  check(revealRes, {
    'GET /reveal: status is 200': (r) => r.status === 200,
    'GET /reveal: not REVEAL_NOT_READY': (r) =>
      typeof r.body !== 'string' || !r.body.includes('REVEAL_NOT_READY'),
  });
}
