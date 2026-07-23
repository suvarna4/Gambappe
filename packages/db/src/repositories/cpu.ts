/**
 * CPU nemesis rivals — data access (docs/plans/cpu-nemesis-wbs.md, WS26-T3).
 *
 * A CPU is a `profiles` row with `kind='cpu'`, `bot_score=1.0` (≥ BOT_EXCLUDE_THRESHOLD, so
 * the existing matcher/crowd/leaderboard exclusions apply by construction), and a
 * `cpu_persona` validated against @receipts/core `CPU_PERSONAS`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { isCpuPersona, slugifyHandle } from '@receipts/core';
import type { CpuPersona, QuestionKind } from '@receipts/core';
import type { Db } from '../client.js';
import { profiles } from '../schema/index.js';

/** Persona of a CPU profile; null for humans, unknown personas, or missing rows. */
export async function getCpuPersona(db: Db, profileId: string): Promise<CpuPersona | null> {
  const rows = await db
    .select({ kind: profiles.kind, cpuPersona: profiles.cpuPersona })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  const row = rows[0];
  if (!row || row.kind !== 'cpu' || !row.cpuPersona) return null;
  return isCpuPersona(row.cpuPersona) ? row.cpuPersona : null;
}

export interface CpuOpenPickTarget {
  pairingId: string;
  cpuProfileId: string;
  persona: CpuPersona;
  questionId: string;
  questionKind: QuestionKind;
  lockAt: Date;
  marketId: string;
}

/**
 * The WS26-T5 sweep's worklist: for every ACTIVE pairing with a CPU side, the OPEN in-play
 * questions (the pairing week's derived dailies + its `pairing_questions` bonuses — same §8.8
 * shape as `getPairingScoreboardQuestions`) where the CPU has no pick yet. Pre-lock is
 * enforced here (`q.lock_at > now()`) *and* again by `placePickTx` — the sweep never
 * places late picks even if it races the lock job.
 */
export async function listActiveCpuPairingsWithOpenQuestion(db: Db): Promise<CpuOpenPickTarget[]> {
  const rows = await db.execute(sql`
    SELECT
      np.id AS pairing_id,
      cpu.id AS cpu_profile_id,
      cpu.cpu_persona AS persona,
      q.id AS question_id,
      q.kind AS question_kind,
      q.lock_at AS lock_at,
      q.market_id AS market_id
    FROM nemesis_pairings np
    JOIN profiles cpu
      ON cpu.id IN (np.profile_a_id, np.profile_b_id)
     AND cpu.kind = 'cpu'
     AND cpu.cpu_persona IS NOT NULL
    JOIN questions q
      ON q.status = 'open'
     AND q.lock_at > now()
     AND (
       (q.kind = 'daily'
         AND q.question_date BETWEEN np.week_start AND (np.week_start + INTERVAL '6 days')::date)
       OR q.id IN (SELECT question_id FROM pairing_questions WHERE pairing_id = np.id)
     )
    LEFT JOIN picks pk ON pk.question_id = q.id AND pk.profile_id = cpu.id
    WHERE np.status = 'active' AND pk.id IS NULL
    ORDER BY q.lock_at ASC
  `);

  const targets: CpuOpenPickTarget[] = [];
  for (const row of rows.rows) {
    const persona = row['persona'] as string;
    if (!isCpuPersona(persona)) continue; // unknown persona (e.g. newer roster) — skip, never guess
    targets.push({
      pairingId: row['pairing_id'] as string,
      cpuProfileId: row['cpu_profile_id'] as string,
      persona,
      questionId: row['question_id'] as string,
      questionKind: row['question_kind'] as QuestionKind,
      lockAt: new Date(row['lock_at'] as string),
      marketId: row['market_id'] as string,
    });
  }
  return targets;
}

export interface AvailableCpuRow {
  profileId: string;
  persona: CpuPersona;
  handle: string;
}

/**
 * CPU rivals free to be force-paired this week (WS26-T4): active `kind='cpu'` profiles with a
 * known persona and no pairing yet for `(seasonId, weekStart)` — the pairing table's partial
 * uniques allow at most one per week per profile, so this list is what's actually insertable.
 * Deterministic order (persona roster order via handle) so the fill is reproducible.
 */
export async function listAvailableCpusForWeek(
  db: Db,
  seasonId: string,
  weekStart: string,
): Promise<AvailableCpuRow[]> {
  const rows = await db.execute(sql`
    SELECT p.id AS profile_id, p.cpu_persona AS persona, p.handle AS handle
    FROM profiles p
    WHERE p.kind = 'cpu' AND p.status = 'active' AND p.cpu_persona IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM nemesis_pairings np
        WHERE np.season_id = ${seasonId}::uuid AND np.week_start = ${weekStart}::date
          AND p.id IN (np.profile_a_id, np.profile_b_id)
      )
    ORDER BY p.handle ASC
  `);
  const out: AvailableCpuRow[] = [];
  for (const row of rows.rows) {
    const persona = row['persona'] as string;
    if (!isCpuPersona(persona)) continue;
    out.push({
      profileId: row['profile_id'] as string,
      persona,
      handle: row['handle'] as string,
    });
  }
  return out;
}

/** The standing roster: one profile per persona. Handles are visibly bot-flavored (T6 adds
 * the explicit badge on top — the handle alone is not the disclosure mechanism). */
export const CPU_ROSTER: ReadonlyArray<{ persona: CpuPersona; handle: string }> = [
  { persona: 'chalk', handle: 'Chalkbot #C001' },
  { persona: 'fade', handle: 'Fadebot #C002' },
  { persona: 'longshot', handle: 'Moonbot #C003' },
  { persona: 'clock', handle: 'Tickbot #C004' },
];

/**
 * Idempotent roster seeding (T3 AC: a real-environment step, not just a test factory —
 * `pnpm --filter @receipts/db db:seed` runs this; re-runs are no-ops keyed on slug).
 * Returns the profile ids by persona.
 */
export async function seedCpuRoster(db: Db, now: Date): Promise<Record<CpuPersona, string>> {
  const ids = {} as Record<CpuPersona, string>;
  for (const { persona, handle } of CPU_ROSTER) {
    const slug = slugifyHandle(handle);
    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.slug, slug), eq(profiles.kind, 'cpu')))
      .limit(1);
    if (existing[0]) {
      ids[persona] = existing[0].id;
      continue;
    }
    const id = uuidv7();
    await db.insert(profiles).values({
      id,
      kind: 'cpu',
      status: 'active',
      handle,
      slug,
      handleIsGenerated: false,
      // ≥ BOT_EXCLUDE_THRESHOLD: excluded from matcher pool/crowd/leaderboards by construction.
      botScore: 1.0,
      cpuPersona: persona,
      lastSeenAt: now,
      // INV-9 requires attestation non-null before any pick exists; a CPU has no user to ask.
      ageAttestedAt: now,
      settings: {},
    });
    ids[persona] = id;
  }
  return ids;
}
