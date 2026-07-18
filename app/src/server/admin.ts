import { NextRequest, NextResponse } from "next/server";
import { getPrincipal } from "./principal";

/**
 * §8.4 admin gate. Production: principal.id must be in ADMIN_USER_IDS
 * (fail closed if unset). Local dev convenience: with no ADMIN_USER_IDS
 * configured and NODE_ENV !== 'production', any request is allowed so
 * the panel is usable without pre-seeding an admin account.
 */
export async function requireAdmin(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const allowlist = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowlist.length === 0 && process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const principal = await getPrincipal(req);
  if (principal && allowlist.includes(principal.id)) {
    return { ok: true };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: { code: "forbidden", message: "Admin access required" } }, { status: 403 }),
  };
}
