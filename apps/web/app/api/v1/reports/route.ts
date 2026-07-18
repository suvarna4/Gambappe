/**
 * `POST /api/v1/reports` (design doc §9.2, §14.3, WS11-T3). Auth: `ghost+` — ghost reports are
 * accepted (content still gets reviewed) but never count toward the auto-pause threshold
 * (report-bombing guard, §14.3): only a claimed profile can BE a qualified reporter, and
 * `submitReport`'s own qualified-reporter count re-filters on `profiles.kind='claimed'`
 * regardless of who files this particular report.
 */
import type { NextResponse } from 'next/server';
import { now } from '@receipts/core';
import { ApiError, createReportBodySchema } from '@receipts/core';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { resolveIdentityFromRequest } from '@/lib/identity-request';
import { submitReport } from '@/lib/moderation';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const { identity } = await resolveIdentityFromRequest(request);
    if (identity.kind === 'anonymous') {
      throw new ApiError('UNAUTHENTICATED', 'a ghost or claimed profile is required');
    }

    const body = createReportBodySchema.parse(await request.json());

    // §14.3: for context_kind='profile', context_id IS the reported profile; for other
    // contexts (post/pairing/duo), whether there's a distinct "reported profile" to
    // auto-pause-count against is content-specific and not resolvable generically here — those
    // report kinds are recorded for the moderation queue but don't drive auto-pause on their
    // own until whichever task builds that resolution (matches WS10-T4's queue, which reads
    // reports as-is without needing this).
    const reportedProfileId = body.context_kind === 'profile' ? body.context_id : null;

    const result = await submitReport(
      getDb(),
      {
        reporterProfileId: identity.profile.id,
        reportedProfileId,
        contextKind: body.context_kind,
        contextId: body.context_id,
        reason: body.reason,
        note: body.note ?? null,
      },
      now(),
    );

    return jsonSuccess({ report_id: result.reportId, status: 'open' as const }, { status: 201 });
  });
}
