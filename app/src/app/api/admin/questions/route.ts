import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { markets, questions } from "@/db/schema";
import { requireAdmin } from "@/server/admin";
import { getAdapter, registerFakeMarket, buildFakeMarket } from "@/venues";
import { etDateTimeToUtc, etDateStr } from "@/shared/time";
import { CONSTANTS } from "@/shared/constants";

const bodySchema = z.object({
  venue: z.enum(["kalshi", "fake"]),
  venueMarketId: z.string().min(1),
  headline: z.string().min(1),
  questionDate: z.string().optional(), // defaults to today (ET)
  fakePriceYes: z.number().min(0).max(1).optional(), // fake venue only, demo convenience
});

/** §5.2/§8.4 curation: paste a venue + ticker, server fetches it once, creates market+question. */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_body", message: "venue, venueMarketId, headline required" } }, { status: 400 });
  }
  const { venue, venueMarketId, headline } = parsed.data;
  const questionDate = parsed.data.questionDate ?? etDateStr(new Date());

  const adapter = getAdapter(venue);
  let venueMarket = await adapter.getMarket(venueMarketId);
  if (!venueMarket && venue === "fake") {
    // FakeVenue's registry is in-memory per process; auto-register a
    // sensible default fixture for the rehearsal/demo flow (§16.3) so
    // curation never blocks on a script having run first. Real venues
    // (kalshi) never hit this branch — 404 stands for them.
    registerFakeMarket(
      buildFakeMarket({
        venueMarketId,
        title: headline,
        priceWalk: [{ at: new Date(0), priceYes: parsed.data.fakePriceYes ?? 0.5 }],
      })
    );
    venueMarket = await adapter.getMarket(venueMarketId);
  }
  if (!venueMarket) {
    return NextResponse.json({ error: { code: "market_not_found", message: "Could not fetch that market from the venue" } }, { status: 404 });
  }

  const [market] = await db
    .insert(markets)
    .values({
      venue,
      venueMarketId,
      title: venueMarket.title,
      category: venueMarket.category ?? "other",
      yesLabel: venueMarket.yesLabel,
      noLabel: venueMarket.noLabel,
      url: venueMarket.url,
      closeTime: venueMarket.closeTime,
      lastPriceYes: venueMarket.priceYes != null ? String(venueMarket.priceYes) : null,
      priceUpdatedAt: venueMarket.priceYes != null ? new Date() : null,
    })
    .returning();

  const opensAt = etDateTimeToUtc(questionDate, CONSTANTS.QUESTION_OPEN_TIME_ET);
  const locksAt = etDateTimeToUtc(questionDate, CONSTANTS.QUESTION_LOCK_TIME_ET);

  const [question] = await db
    .insert(questions)
    .values({
      marketId: market.id,
      kind: "daily",
      questionDate,
      opensAt,
      locksAt,
      status: "draft",
      headline,
    })
    .returning();

  return NextResponse.json({ question, market });
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const rows = await db.select().from(questions).orderBy(desc(questions.createdAt)).limit(50);
  return NextResponse.json({ questions: rows });
}
