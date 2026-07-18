import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { markets, questions, picks, users } from "@/db/schema";
import { hmacSign } from "@/server/crypto";
import { POST } from "./route";

async function makeGhostCookieHeader(handle: string): Promise<string> {
  const [u] = await db.insert(users).values({ kind: "ghost", handle }).returning();
  return `receipts_ghost=${u.id}.${hmacSign(u.id, "GHOST_COOKIE_SECRET")}`;
}

async function makeOpenQuestion(lastPriceYes = "0.63") {
  const [m] = await db
    .insert(markets)
    .values({
      venue: "fake",
      venueMarketId: `fake-${crypto.randomUUID()}`,
      title: "Test",
      category: "sports",
      yesLabel: "Yes",
      noLabel: "No",
      url: "https://example.test",
      lastPriceYes,
      priceUpdatedAt: new Date(),
    })
    .returning();
  const [q] = await db
    .insert(questions)
    .values({
      marketId: m.id,
      kind: "daily",
      questionDate: "2026-07-18",
      opensAt: new Date(Date.now() - 3600_000),
      locksAt: new Date(Date.now() + 3600_000),
      status: "open",
      headline: "Will it happen?",
    })
    .returning();
  return q;
}

function postReq(body: unknown, cookie?: string) {
  return new NextRequest("http://localhost/api/picks", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
  });
}

describe("POST /api/picks (§5.3)", () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table picks, user_stats, questions, markets, users, rate_limits cascade`);
  });

  it("one-tap: mints a ghost inline and stamps the entry price, no cookie required", async () => {
    const q = await makeOpenQuestion("0.63");
    const res = await POST(postReq({ questionId: q.id, side: "yes" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.pick.side).toBe("yes");
    expect(json.pick.entryPrice).toBeCloseTo(0.63, 5);
    // D-16: response never includes a crowd split, only a total count.
    expect(json.pick.crowdYes).toBeUndefined();
    expect(json.participantCount).toBe(1);
    expect(res.cookies.get("receipts_ghost")).toBeDefined();
  });

  it("side='no' stamps 1 - priceYes", async () => {
    const q = await makeOpenQuestion("0.63");
    const res = await POST(postReq({ questionId: q.id, side: "no" }));
    const json = await res.json();
    expect(json.pick.entryPrice).toBeCloseTo(0.37, 5);
  });

  it("double pick from the same principal returns 409 with the existing pick, never the split", async () => {
    const q = await makeOpenQuestion();
    const first = await POST(postReq({ questionId: q.id, side: "yes" }));
    const setCookie = first.cookies.get("receipts_ghost")!.value;
    const cookieHeader = `receipts_ghost=${setCookie}`;

    const second = await POST(postReq({ questionId: q.id, side: "no" }, cookieHeader));
    expect(second.status).toBe(409);
    const json = await second.json();
    expect(json.pick.side).toBe("yes"); // original pick preserved (INV-3)
  });

  it("concurrent picks from the same user resolve to exactly one row", async () => {
    const q = await makeOpenQuestion();
    const cookieHeader = await makeGhostCookieHeader("concurrent-tester");

    const results = await Promise.all(
      Array.from({ length: 5 }, () => POST(postReq({ questionId: q.id, side: "yes" }, cookieHeader)))
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);

    const rows = await db.select().from(picks).where(sql`1=1`);
    expect(rows.length).toBe(1);
  });

  it("rejects with 503 when the price is stale", async () => {
    const [m] = await db
      .insert(markets)
      .values({
        venue: "fake",
        venueMarketId: `fake-stale-${crypto.randomUUID()}`,
        title: "Stale",
        category: "sports",
        yesLabel: "Yes",
        noLabel: "No",
        url: "https://example.test",
        lastPriceYes: "0.5",
        priceUpdatedAt: new Date(Date.now() - 10 * 60_000), // 10 min old > 300s gate
      })
      .returning();
    const [q] = await db
      .insert(questions)
      .values({
        marketId: m.id,
        kind: "daily",
        questionDate: "2026-07-19",
        opensAt: new Date(Date.now() - 3600_000),
        locksAt: new Date(Date.now() + 3600_000),
        status: "open",
        headline: "Stale price test",
      })
      .returning();
    const res = await POST(postReq({ questionId: q.id, side: "yes" }));
    expect(res.status).toBe(503);
  });

  it("rejects picks on a locked question", async () => {
    const q = await makeOpenQuestion();
    await db.update(questions).set({ status: "locked" }).where(sql`id = ${q.id}`);
    const res = await POST(postReq({ questionId: q.id, side: "yes" }));
    expect(res.status).toBe(409);
  });
});
