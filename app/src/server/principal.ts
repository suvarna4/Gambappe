import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, sessions, ghostDevices } from "@/db/schema";
import { hmacVerify, hmacSign, sha256Hex, randomToken } from "./crypto";
import { generateHandle } from "./handles";
import { checkRateLimit } from "./rate-limit";
import { CONSTANTS } from "@/shared/constants";

export const GHOST_COOKIE_NAME = "receipts_ghost";
export const SESSION_COOKIE_NAME = "receipts_session";

export type PrincipalKind = "ghost" | "pending" | "claimed";

export interface Principal {
  id: string;
  kind: PrincipalKind;
  handle: string;
}

function ipHash(req: NextRequest): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  return hmacSign(ip, "GHOST_COOKIE_SECRET");
}

function uaHash(req: NextRequest): string {
  return hmacSign(req.headers.get("user-agent") ?? "unknown", "GHOST_COOKIE_SECRET");
}

/**
 * §7.1.1: session cookie -> pending/claimed user; else ghost cookie ->
 * ghost user; else null. A bad HMAC or a uuid that no longer resolves is
 * cleared and treated as absent — never a 500.
 */
export async function getPrincipal(req: NextRequest): Promise<Principal | null> {
  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionToken) {
    const tokenHash = sha256Hex(sessionToken);
    const rows = await db
      .select({
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        kind: users.kind,
        handle: users.handle,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, tokenHash))
      .limit(1);
    const row = rows[0];
    if (row && row.expiresAt.getTime() > Date.now() && row.status !== "deleted") {
      return { id: row.userId, kind: row.kind as PrincipalKind, handle: row.handle };
    }
  }

  const ghostCookie = req.cookies.get(GHOST_COOKIE_NAME)?.value;
  if (ghostCookie) {
    const [id, sig] = ghostCookie.split(".");
    if (id && sig && hmacVerify(id, sig, "GHOST_COOKIE_SECRET")) {
      const rows = await db
        .select({ id: users.id, kind: users.kind, handle: users.handle, status: users.status })
        .from(users)
        .where(and(eq(users.id, id), eq(users.kind, "ghost")))
        .limit(1);
      const row = rows[0];
      if (row && row.status === "active") {
        return { id: row.id, kind: "ghost", handle: row.handle };
      }
    }
  }

  return null;
}

export interface MintedGhost {
  principal: Principal;
  cookieValue: string;
}

/**
 * §7.1.2 ghost minting. Lazy (called only from a participating action,
 * never on page view). Enforces GHOST_MINT_LIMIT_PER_IP_DAY. Caller sets
 * the returned cookieValue on receipts_ghost in its response.
 */
export async function mintGhost(req: NextRequest): Promise<MintedGhost | { rateLimited: true }> {
  const ip = ipHash(req);
  const { allowed } = await checkRateLimit(
    `ghost_mint:${ip}`,
    CONSTANTS.GHOST_MINT_LIMIT_PER_IP_DAY,
    24 * 60 * 60
  );
  if (!allowed) return { rateLimited: true };

  let handle = generateHandle();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, handle))
      .limit(1);
    if (existing.length === 0) break;
    handle = generateHandle();
  }

  const [row] = await db
    .insert(users)
    .values({ kind: "ghost", handle })
    .returning({ id: users.id, kind: users.kind, handle: users.handle });

  await db.insert(ghostDevices).values({
    userId: row.id,
    ipHash: ip,
    uaHash: uaHash(req),
  });

  const cookieValue = `${row.id}.${hmacSign(row.id, "GHOST_COOKIE_SECRET")}`;
  return {
    principal: { id: row.id, kind: "ghost", handle: row.handle },
    cookieValue,
  };
}

export const GHOST_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: CONSTANTS.GHOST_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
  path: "/",
};

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: CONSTANTS.SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
  path: "/",
};

export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + CONSTANTS.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: tokenHash, userId, expiresAt });
  return token;
}
