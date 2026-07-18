import { NextRequest, NextResponse } from "next/server";
import { runCronTick } from "@/db/lifecycle";

/**
 * §16.3: single idempotent sweep endpoint. Triggered by Vercel Cron
 * every minute (which sends `Authorization: Bearer $CRON_SECRET`), an
 * admin "tick now" button, and rehearsal scripts (which may send the
 * same secret via `x-cron-secret` for convenience outside Vercel).
 */
export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const customHeader = req.headers.get("x-cron-secret");
  const provided = bearer ?? customHeader;

  if (!provided || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: { code: "unauthorized", message: "bad cron secret" } }, { status: 401 });
  }
  const result = await runCronTick(new Date());
  return NextResponse.json({ ok: true, ...result });
}
