/**
 * WS14-T2 load test — spectator page burst (design doc §17.1: "spectator page burst
 * (simulating a viral card: 500 rps for 2 min, p95 < 300ms from CDN/ISR)", §10.2, §18
 * "Launch-day posture: ISR + CDN carries spectator load").
 *
 * Hits the real `/q/[slug]` ISR page (design doc §10.1: `revalidate 30s + on-demand`) for a
 * single question, simulating every visitor landing on the same viral card. Locally (no CDN in
 * front of `next start`) this exercises Next's own ISR cache, which is the same mechanism the
 * CDN sits in front of in prod — after the first render, subsequent requests within the 30s
 * window are served from cache without touching Postgres, which is the behavior this threshold
 * is actually gating on.
 *
 * Requires `apps/web/load-tests/seed.ts` to have been run first (writes
 * `.fixtures/load-test-fixture.json`, which supplies `spectatorQuestionSlug`) and a real
 * `next build && next start` (or staging) instance reachable at `LOAD_TEST_BASE_URL`.
 *
 * Usage:
 *   LOAD_TEST_BASE_URL=http://localhost:39142 k6 run scenarios/spectator-burst.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.LOAD_TEST_BASE_URL || 'http://localhost:3000';
const fixture = JSON.parse(
  open(__ENV.LOAD_TEST_FIXTURE_PATH || '../.fixtures/load-test-fixture.json'),
);

const nonOkRate = new Rate('non_2xx_rate');

export const options = {
  scenarios: {
    spectator_burst: {
      executor: 'constant-arrival-rate',
      // §17.1, verbatim: 500 rps for 2 minutes.
      rate: 500,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 200,
      maxVUs: 600,
    },
  },
  thresholds: {
    // §17.1, verbatim: "p95 < 300ms from CDN/ISR".
    http_req_duration: ['p(95)<300'],
    non_2xx_rate: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function spectatorBurst() {
  const res = http.get(`${BASE_URL}/q/${fixture.spectatorQuestionSlug}`, {
    tags: { endpoint: 'spectator_page' },
  });
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body contains the headline': (r) => typeof r.body === 'string' && r.body.includes('load test'),
  });
  nonOkRate.add(!ok);
}
