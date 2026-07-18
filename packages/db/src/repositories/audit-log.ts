/**
 * audit_log repository (§5.6, §15.1, §15.5, WS10-T1). Written by every admin mutation —
 * the invariant is enforced by `apps/web/lib/admin-audit.ts`'s `withAdminAudit` wrapper,
 * not by anything in this file; this is just the storage primitive.
 */
import { desc } from 'drizzle-orm';
import { auditLog } from '../schema/index.js';
import type { Db } from '../client.js';

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

export async function insertAuditLog(db: Db, row: NewAuditLogRow): Promise<AuditLogRow> {
  const [inserted] = await db.insert(auditLog).values(row).returning();
  if (!inserted) throw new Error('insertAuditLog: no row returned');
  return inserted;
}

/** Most-recent-first, for the ops dashboard (WS10-T5) and admin review. */
export async function listAuditLog(db: Db, limit = 50): Promise<AuditLogRow[]> {
  return db.select().from(auditLog).orderBy(desc(auditLog.ts)).limit(limit);
}
