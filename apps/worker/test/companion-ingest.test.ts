/**
 * XH-T5 unit AC (docs/xtrace-hackathon-tasks.md): flag-off (and xTrace-unconfigured) is a
 * no-op that never touches the DB — proven with a poisoned `ctx.db` that throws on any
 * property access, so the assertion holds even if a future edit accidentally reads it. The
 * real-Postgres acceptance criteria live in test/integration/companion-ingest.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { companionIngestHandler } from '../src/jobs/companion-ingest.js';
import type { JobContext } from '../src/context.js';

function poisonedCtx(): JobContext {
  const poisonedDb = new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`unexpected DB access via ctx.db.${String(prop)}`);
      },
    },
  );
  return {
    db: poisonedDb as JobContext['db'],
    pool: undefined as unknown as JobContext['pool'],
    boss: undefined as unknown as JobContext['boss'],
    redis: undefined as unknown as JobContext['redis'],
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const originals = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

describe('companionIngestHandler — flag/config gating (unit, no DB)', () => {
  it('is a no-op when the companion flag is disabled', async () => {
    await withEnv({ FLAG_COMPANION: 'false' }, async () => {
      await expect(companionIngestHandler(poisonedCtx(), undefined)).resolves.toBeUndefined();
    });
  });

  it('is a no-op when xTrace is unconfigured', async () => {
    await withEnv(
      { FLAG_COMPANION: 'true', XTRACE_API_KEY: undefined, XTRACE_APP_ID: undefined },
      async () => {
        await expect(companionIngestHandler(poisonedCtx(), undefined)).resolves.toBeUndefined();
      },
    );
  });
});
