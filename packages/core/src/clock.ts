/**
 * The clock (design doc §17.2). Worker and API code read time via `now()` — never
 * `new Date()` directly — so tests can time-travel lock/reveal via TEST_CLOCK.
 *
 * Overriding is permitted ONLY in test environments (NODE_ENV=test or TEST_CLOCK_ENABLED=1).
 * Note: Postgres remains the clock authority for pick admission (§6.2 step 3); this clock is
 * for app/worker scheduling and presentation logic.
 */

let overrideMs: number | null = null;
let envInitialized = false;

function testClockAllowed(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.TEST_CLOCK_ENABLED === '1';
}

function parseInstant(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const asNum = Number(value);
  if (Number.isFinite(asNum) && value.trim() !== '') return asNum;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`TEST_CLOCK: unparseable instant "${value}"`);
  return parsed;
}

function initFromEnv(): void {
  if (envInitialized) return;
  envInitialized = true;
  const envValue = process.env.TEST_CLOCK;
  if (envValue !== undefined && envValue !== '' && testClockAllowed()) {
    overrideMs = parseInstant(envValue);
  }
}

/** Current time. Honors the test clock override when (and only when) tests enable it. */
export function now(): Date {
  initFromEnv();
  return overrideMs === null ? new Date() : new Date(overrideMs);
}

/** Epoch milliseconds convenience (e.g. the `x-server-time` header, §9.1). */
export function nowMs(): number {
  return now().getTime();
}

/** True when a test override is active. */
export function isTestClockActive(): boolean {
  initFromEnv();
  return overrideMs !== null;
}

/** Set (or clear, with null) the test clock. Throws outside test environments (§17.2). */
export function setTestClock(value: string | number | Date | null): void {
  if (!testClockAllowed()) {
    throw new Error('setTestClock is only available when NODE_ENV=test or TEST_CLOCK_ENABLED=1');
  }
  envInitialized = true; // explicit set supersedes env initialization
  overrideMs = value === null ? null : parseInstant(value);
}

/** Advance the active test clock by `ms`. Throws if no override is active. */
export function advanceTestClock(ms: number): void {
  if (!testClockAllowed()) {
    throw new Error(
      'advanceTestClock is only available when NODE_ENV=test or TEST_CLOCK_ENABLED=1',
    );
  }
  initFromEnv();
  if (overrideMs === null) {
    throw new Error('advanceTestClock: no test clock is active — call setTestClock first');
  }
  overrideMs += ms;
}
