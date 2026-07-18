import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrincipal } from "@/server/principal";
import { track } from "@/server/events";
import { checkRateLimit } from "@/server/rate-limit";
import { ALLOWED_EVENT_NAMES } from "@/shared/events";
import { CONSTANTS } from "@/shared/constants";

const bodySchema = z.object({
  name: z.enum(ALLOWED_EVENT_NAMES),
  props: z.record(z.string(), z.unknown()).optional().default({}),
});

/** §7.17/§8.2 POST /api/events — client track() relay. Allowlisted names, 1KB cap, rate-limited. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 1024) {
    return NextResponse.json({ error: { code: "payload_too_large", message: "Event payload too large" } }, { status: 413 });
  }
  const parsed = bodySchema.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: "Unknown event" } }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`events:${ip}`, CONSTANTS.EVENTS_RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: { code: "rate_limited", message: "Too many events" } }, { status: 429 });
  }

  const principal = await getPrincipal(req);
  await track(parsed.data.name, principal?.id ?? null, parsed.data.props);
  return NextResponse.json({ ok: true });
}
