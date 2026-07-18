/**
 * `POST /api/v1/claim` (design doc §6.3, §9.2). Auth: valid Auth.js session (the ghost-cookie
 * state is read separately inside `runClaim`, per the task brief — cases A–D distinguish "no
 * profile yet" from "anonymous", which a generic `ghost+`/`claimed` resolver can't express).
 */
import type { NextResponse } from 'next/server';
import { ApiError, claimBodySchema } from '@receipts/core';
import { auth } from '../../../../auth';
import { jsonSuccess, runRoute } from '@/lib/api-response';
import { assertSameOrigin } from '@/lib/origin-check';
import { runClaim } from '@/lib/claim-flow';
import { GHOST_COOKIE_NAME, clearedGhostCookieOptions } from '@/lib/ghost-cookie';
import { toMeProfile } from '@/lib/serialize-profile';
import { getDb } from '@/lib/stores';

export const runtime = 'nodejs';

function readGhostCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === GHOST_COOKIE_NAME) {
      // A malformed percent-encoding throws URIError — treat exactly like a missing cookie
      // (anonymous), never a 500 (§6.1.1: "never throws on a bad cookie").
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function POST(request: Request): Promise<NextResponse> {
  return runRoute(async () => {
    assertSameOrigin(request);

    const session = await auth();
    if (!session?.user?.id) throw new ApiError('UNAUTHENTICATED', 'sign-in required to claim');

    const body = claimBodySchema.parse(await request.json().catch(() => ({})));
    const ghostCookieValue = readGhostCookie(request);

    const result = await runClaim(getDb(), {
      userId: session.user.id,
      ghostCookieValue,
      ageAttested: body.age_attested,
      notMe: body.not_me,
    });

    const response = jsonSuccess({ profile: toMeProfile(result.profile), case: result.case });
    if (result.clearGhostCookie) {
      response.cookies.set(GHOST_COOKIE_NAME, '', clearedGhostCookieOptions());
    }
    return response;
  });
}
