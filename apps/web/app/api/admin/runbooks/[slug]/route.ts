/**
 * `GET /api/admin/runbooks/:slug` — serves the in-repo `docs/runbooks/*.md` files linked from
 * the ops dashboard (§15.5, WS10-T5). Next.js only auto-serves `public/`; there's no `public/`
 * dir in this app, and linking straight to `/docs/runbooks/*.md` 404s, so this route reads
 * the file at request time instead. `outputFileTracingIncludes` in next.config.ts ensures the
 * `docs/` directory is included in a standalone/serverless build's traced output.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { ApiError, errorEnvelope } from '@receipts/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Allowlist, not a free-form path join — no directory traversal via an arbitrary `slug`. */
const RUNBOOK_SLUGS = new Set([
  'question-day-checklist',
  'venue-outage',
  'settlement-dispute',
  'launch-drill',
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!RUNBOOK_SLUGS.has(slug)) {
    const err = new ApiError('NOT_FOUND', 'Unknown runbook');
    return NextResponse.json(errorEnvelope(err), { status: err.status });
  }

  const path = join(process.cwd(), '..', '..', 'docs', 'runbooks', `${slug}.md`);
  try {
    const content = await readFile(path, 'utf8');
    return new Response(content, {
      status: 200,
      headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch {
    const err = new ApiError('NOT_FOUND', 'Runbook file missing');
    return NextResponse.json(errorEnvelope(err), { status: err.status });
  }
}
