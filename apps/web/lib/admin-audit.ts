/**
 * The "every admin mutation writes audit_log" invariant (§15.1, §5.6, WS10-T1 AC).
 * Every future admin mutation route (WS10-T2 curation, WS10-T3 settlement/void/regrade,
 * WS10-T4 moderation actions) MUST wrap its handler in `withAdminAudit` to inherit this —
 * it is not enforced structurally by the auth middleware, which only gates access.
 */
import { insertAuditLog, type Db } from '@receipts/db';

export interface AuditContext {
  /** Null at P0 (stopgap token auth has no per-admin identity); real once WS2-T2/P1 lands. */
  actorUserId?: string | null;
  action: string;
  target: string;
  detail?: Record<string, unknown>;
}

export async function recordAuditLog(db: Db, ctx: AuditContext): Promise<void> {
  await insertAuditLog(db, {
    actorUserId: ctx.actorUserId ?? null,
    action: ctx.action,
    target: ctx.target,
    detail: ctx.detail ?? {},
  });
}

/**
 * Wraps an admin route handler: on a successful (ok) response, records an audit_log row.
 * A thrown error or a non-ok response is NOT audited as a successful mutation — only
 * completed changes are logged, matching "every admin mutation" (not every attempt).
 */
export function withAdminAudit(
  db: Db,
  action: string,
  targetFromRequest: (request: Request) => string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const response = await handler(request);
    if (response.ok) {
      await recordAuditLog(db, {
        action,
        target: targetFromRequest(request),
        detail: { method: request.method, status: response.status },
      });
    }
    return response;
  };
}
