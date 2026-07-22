/**
 * WS25-T4: guards `apps/web/package.json`'s direct `@auth/core` dependency against silent
 * drift from `next-auth`'s own internal `@auth/core` dependency.
 *
 * `auth.ts` throws `EmailSignInError` (imported directly from `@auth/core/errors`) to make
 * Auth.js's routing degrade gracefully instead of hitting its generic error page — see
 * `auth-error-routing.test.ts`. That routing decision hinges on `error instanceof AuthError`
 * (`@auth/core`'s own `Auth()`), which only holds if this direct import and `next-auth`'s
 * internal `@auth/core` resolve to the SAME installed package instance. pnpm keeps them
 * identical only as long as both declared versions actually match; if `next-auth` is ever
 * bumped without updating this pin in lockstep, pnpm would materialize two separate `@auth/core`
 * instances, silently breaking the `instanceof` check with no other test to catch it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

describe('@auth/core version pin (WS25-T4)', () => {
  it("apps/web's direct @auth/core dependency matches next-auth's own internal @auth/core dependency exactly", () => {
    const webPkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const nextAuthPkgPath = require.resolve('next-auth/package.json');
    const nextAuthPkg = JSON.parse(readFileSync(nextAuthPkgPath, 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(webPkg.dependencies['@auth/core']).toBe(nextAuthPkg.dependencies['@auth/core']);
  });
});
