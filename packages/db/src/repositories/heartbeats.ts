/**
 * job_heartbeats writes (§15.5): every job is heartbeat-writing (§19.4 rule 4).
 * Used by apps/worker around every handler run.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobHeartbeats } from '../schema/index.js';

export async function recordJobStart(db: Db, jobName: string, at: Date): Promise<void> {
  await db
    .insert(jobHeartbeats)
    .values({ jobName, lastStartedAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: jobHeartbeats.jobName,
      set: { lastStartedAt: at, updatedAt: at },
    });
}

export async function recordJobSuccess(db: Db, jobName: string, at: Date): Promise<void> {
  await db
    .insert(jobHeartbeats)
    .values({ jobName, lastSuccessAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: jobHeartbeats.jobName,
      set: { lastSuccessAt: at, updatedAt: at },
    });
}

export async function recordJobFailure(
  db: Db,
  jobName: string,
  at: Date,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .insert(jobHeartbeats)
    .values({ jobName, lastErrorAt: at, lastError: message, updatedAt: at })
    .onConflictDoUpdate({
      target: jobHeartbeats.jobName,
      set: { lastErrorAt: at, lastError: message, updatedAt: at },
    });
}

/** Staleness view for the ops dashboard (§15.5). */
export async function getHeartbeats(db: Db) {
  return db
    .select()
    .from(jobHeartbeats)
    .orderBy(sql`${jobHeartbeats.jobName}`);
}
