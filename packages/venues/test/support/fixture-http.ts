/**
 * Test-only helpers: load recorded fixtures (`fixtures/kalshi/*.json`,
 * `fixtures/polymarket/*.json`) and turn them into a routed `fetch` stub, so adapter tests
 * never touch the network (§7.2 "no live calls in CI").
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** packages/venues/test/support -> repo root (4 levels up). */
export const FIXTURES_ROOT = join(here, '..', '..', '..', '..', 'fixtures');

export function loadFixture(...segments: string[]): unknown {
  const path = join(FIXTURES_ROOT, ...segments);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export interface FixtureRoute {
  status: number;
  body: unknown;
}

export type FixtureRouter = (url: URL) => FixtureRoute | undefined;

/** Builds a `fetch`-compatible stub from a router; unmatched routes 404. */
export function createFixtureFetch(router: FixtureRouter): typeof fetch {
  return (async (input: string | URL, _init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const route = router(url);
    if (!route) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}
