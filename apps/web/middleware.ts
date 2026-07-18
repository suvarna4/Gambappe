/**
 * Admin route gate (§15.1, §19.5, WS10-T1). Covers both `/admin/*` pages and
 * `/api/admin/*` routes with one check: non-admin/no-token requests 404 (not 401/403 —
 * the existence of admin surfaces isn't acknowledged to unauthorized callers).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminRequestAuthorized } from '@/lib/admin-auth';

export function middleware(request: NextRequest): NextResponse {
  const authorized = isAdminRequestAuthorized(
    request.headers,
    {
      ADMIN_STOPGAP_TOKEN: process.env.ADMIN_STOPGAP_TOKEN,
      ADMIN_STOPGAP_IP_ALLOWLIST: process.env.ADMIN_STOPGAP_IP_ALLOWLIST,
    },
    request.nextUrl.searchParams.get('token'),
  );
  if (!authorized) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
