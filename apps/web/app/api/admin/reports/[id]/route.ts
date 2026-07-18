/**
 * `PATCH /api/admin/reports/:id` — resolve a report (§15.4, WS10-T4): dismiss / remove
 * content / pause / suspend. All four write both the report row and (except dismiss) a
 * side-effect row in ONE transaction, then are audited via withAdminAudit (§15.1 invariant).
 */
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope, nowMs } from '@receipts/core';
import { getDb } from '@/lib/stores';
import { getReportById, resolveReport, updatePostStatus, updateProfileStatus, type Db } from '@receipts/db';
import { withAdminAudit } from '@/lib/admin-audit';
import { applyDuoMidWindowExit } from '@/lib/duo-match-lifecycle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const resolveBodySchema = z.object({
  action: z.enum(['dismiss', 'remove_content', 'pause', 'suspend']),
});

function rejected(err: ApiError): NextResponse {
  return NextResponse.json(errorEnvelope(err), {
    status: err.status,
    headers: { 'x-server-time': String(nowMs()) },
  });
}

async function patchHandler(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).pathname.split('/').at(-1)!;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return rejected(new ApiError('VALIDATION_FAILED', 'Body must be valid JSON'));
  }
  const parsed = resolveBodySchema.safeParse(json);
  if (!parsed.success) {
    return rejected(new ApiError('VALIDATION_FAILED', 'Invalid resolve action', parsed.error.flatten()));
  }
  const { action } = parsed.data;

  const db = getDb();
  const report = await getReportById(db, id);
  if (!report) return rejected(new ApiError('NOT_FOUND', 'Report not found'));
  if (report.status !== 'open') {
    return rejected(new ApiError('REPORT_ALREADY_RESOLVED', `Report was already ${report.status}`));
  }

  if (action === 'remove_content' && report.contextKind !== 'post') {
    return rejected(
      new ApiError('VALIDATION_FAILED', `remove_content only applies to post reports, not ${report.contextKind}`),
    );
  }
  if ((action === 'pause' || action === 'suspend') && !report.reportedProfileId) {
    return rejected(new ApiError('VALIDATION_FAILED', `${action} requires the report to name a reported profile`));
  }

  const resolvedAt = new Date(nowMs());
  const updated = await db.transaction(async (tx) => {
    const row = await resolveReport(tx as Db, id, {
      status: action === 'dismiss' ? 'dismissed' : 'actioned',
      resolvedByUserId: null, // P0 stopgap auth has no per-admin identity (§19.5)
      resolvedAt,
    });
    if (action === 'remove_content') {
      await updatePostStatus(tx as Db, report.contextId, 'removed_by_mod');
    } else if (action === 'pause') {
      await updateProfileStatus(tx as Db, report.reportedProfileId!, 'paused_matchmaking');
    } else if (action === 'suspend') {
      await updateProfileStatus(tx as Db, report.reportedProfileId!, 'suspended');
      // §5.7 mid-window exit: suspension is one of the trigger events ("block, pause,
      // suspension, deletion") for a duo match in progress, same integrity rule as nemesis
      // (WS6-T2). `pause` is deliberately NOT wired here — nemesis's own precedent
      // (moderation.ts's `applyBlock`) only triggers on block, not pause/suspend/delete, so
      // there's no existing behavior to mirror for those; this task's brief explicitly scoped
      // the duo trigger set to "deleted/suspended/blocked" only.
      await applyDuoMidWindowExit(tx as Db, report.reportedProfileId!, resolvedAt);
    }
    return row;
  });

  return NextResponse.json(
    { data: updated },
    { status: 200, headers: { 'x-server-time': String(nowMs()) } },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  const wrapped = withAdminAudit(getDb(), 'report.resolve', (req) => new URL(req.url).pathname, patchHandler);
  return wrapped(request);
}
