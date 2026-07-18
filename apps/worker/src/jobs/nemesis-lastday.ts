/**
 * `nemesis:lastday` (WS9-T3, §7.6, §13.3, Sun 09:00 ET): fires the `nemesis_last_day` beat
 * ("{a}–{b}. One day left. {trailer} needs the sweep.") for pairings entering the final day of
 * their nemesis week.
 *
 * SPEC-GAP(WS9-T3): WS5 (nemesis matchmaking + weekly scoring, §8.4/§8.8) hasn't landed on this
 * branch, so `nemesis_pairings` (WS0-T3 schema, table exists) has no populated rows and no
 * verified score/"questions left" semantics to drive the beat's "close score" trigger condition
 * (§13.3 lists the trigger as "Sunday morning, close score" without a numeric threshold, and
 * that threshold is properly WS5's call to pin alongside the rest of nemesis scoring). Per the
 * design doc's mock-start pattern (§19.2: "WS9-T3 (vs WS4-T6)"), this job is implemented as a
 * correctly-scheduled, idempotent, heartbeat-writing NO-OP: it queries for active pairings and,
 * finding none, does nothing — genuinely correct behavior today, and the natural place for
 * WS5-T1..T3 to hang the real beat-selection logic (mirroring `reveal-beats.ts`'s pattern: derive
 * beats pure, then `writeBeatsToOutbox`) once pairings exist.
 */
import { now } from '@receipts/core';
import { listActiveNemesisPairings, type Db } from '@receipts/db';
import type { JobHandler } from '../heartbeat.js';
import { logger } from '../logger.js';

export interface NemesisLastdayReport {
  activePairings: number;
  beatsWritten: number;
}

export async function runNemesisLastday(db: Db, at: Date = now()): Promise<NemesisLastdayReport> {
  const pairings = await listActiveNemesisPairings(db);
  if (pairings.length === 0) {
    return { activePairings: 0, beatsWritten: 0 };
  }

  // SPEC-GAP(WS9-T3): see header — no scoring data model to select/derive `nemesis_last_day`
  // beats from yet. Logged (not silently dropped) so an operator can see pairings exist without
  // this job acting on them, once WS5 starts populating `nemesis_pairings`.
  logger.warn(
    { activePairings: pairings.length, at },
    'nemesis:lastday — active pairings found but WS5 scoring is not implemented on this branch; SPEC-GAP(WS9-T3), no beats fired',
  );
  return { activePairings: pairings.length, beatsWritten: 0 };
}

export const nemesisLastdayHandler: JobHandler = async (ctx) => {
  const report = await runNemesisLastday(ctx.db);
  logger.info({ report }, 'nemesis:lastday complete');
};
