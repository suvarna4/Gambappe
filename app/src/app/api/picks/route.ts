import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { picks, questions, markets, questionParticipants } from "@/db/schema";
import {
  getPrincipal,
  mintGhost,
  GHOST_COOKIE_NAME,
  GHOST_COOKIE_OPTIONS,
} from "@/server/principal";
import { checkRateLimit } from "@/server/rate-limit";
import { track } from "@/server/events";
import { CONSTANTS } from "@/shared/constants";

const bodySchema = z.object({
  questionId: z.string().uuid(),
  side: z.enum(["yes", "no"]),
});

/** §5.3 POST /api/picks — the most important handler in the product. */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "questionId and side are required" } },
      { status: 400 }
    );
  }
  const { questionId, side } = parsed.data;

  // 1. Resolve principal, minting a ghost inline if absent (§7.1.2).
  let principal = await getPrincipal(req);
  let ghostCookieValue: string | null = null;
  if (!principal) {
    const minted = await mintGhost(req);
    if ("rateLimited" in minted) {
      return NextResponse.json(
        { error: { code: "ghost_mint_limited", message: "Too many new visitors from this network today. Try again tomorrow." } },
        { status: 429 }
      );
    }
    principal = minted.principal;
    ghostCookieValue = minted.cookieValue;
  }

  const rl = await checkRateLimit(`pick:${principal.id}`, CONSTANTS.PICK_RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Slow down — too many picks." } },
      { status: 429 }
    );
  }

  const [question] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
  if (!question || question.kind === "placement") {
    return respond({ error: { code: "not_found", message: "Question not found" } }, 404, ghostCookieValue);
  }

  // Participant gating (§4.3): only meaningful for nemesis_bonus/duo
  // kinds — daily/placement have no question_participants rows.
  if (question.kind === "nemesis_bonus" || question.kind === "duo") {
    const [membership] = await db
      .select()
      .from(questionParticipants)
      .where(and(eq(questionParticipants.questionId, questionId), eq(questionParticipants.userId, principal.id)))
      .limit(1);
    if (!membership) {
      return respond({ error: { code: "not_found", message: "Question not found" } }, 404, ghostCookieValue);
    }
  }

  if (question.status !== "open" || Date.now() >= question.locksAt.getTime()) {
    return respond(
      { error: { code: "question_closed", message: "This question is no longer accepting picks." } },
      409,
      ghostCookieValue
    );
  }

  const [market] = await db.select().from(markets).where(eq(markets.id, question.marketId)).limit(1);
  const staleMs = CONSTANTS.PRICE_MAX_STALENESS_SEC * 1000;
  if (
    !market?.lastPriceYes ||
    !market.priceUpdatedAt ||
    Date.now() - market.priceUpdatedAt.getTime() > staleMs
  ) {
    return respond(
      { error: { code: "price_stale", message: "Price is too stale to stamp a pick right now. Try again shortly." } },
      503,
      ghostCookieValue
    );
  }

  const priceYes = Number(market.lastPriceYes);
  const entryPrice = side === "yes" ? priceYes : 1 - priceYes;

  try {
    const [pick] = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(picks)
        .values({
          questionId,
          userId: principal!.id,
          side,
          entryPrice: String(entryPrice),
          entryPriceAt: market.priceUpdatedAt!,
        })
        .returning();
      await tx
        .update(questions)
        .set(
          side === "yes"
            ? { crowdYes: question.crowdYes + 1 }
            : { crowdNo: question.crowdNo + 1 }
        )
        .where(eq(questions.id, questionId));
      return [inserted];
    });

    await track("pick_created", principal.id, { questionId, side });

    return respond(
      {
        pick: {
          id: pick.id,
          side: pick.side,
          entryPrice: Number(pick.entryPrice),
          pickedAt: pick.pickedAt.toISOString(),
        },
        participantCount: question.crowdYes + question.crowdNo + 1,
      },
      201,
      ghostCookieValue
    );
  } catch (err: unknown) {
    // Unique violation -> 409 with the existing pick (D-16: no split, ever).
    const [existing] = await db
      .select()
      .from(picks)
      .where(and(eq(picks.questionId, questionId), eq(picks.userId, principal.id)))
      .limit(1);
    if (existing) {
      return respond(
        {
          pick: {
            id: existing.id,
            side: existing.side,
            entryPrice: Number(existing.entryPrice),
            pickedAt: existing.pickedAt.toISOString(),
          },
          participantCount: question.crowdYes + question.crowdNo,
        },
        409,
        ghostCookieValue
      );
    }
    console.error("pick insert failed", err);
    return respond({ error: { code: "internal", message: "Something went wrong." } }, 500, ghostCookieValue);
  }
}

function respond(body: unknown, status: number, ghostCookieValue: string | null) {
  const res = NextResponse.json(body, { status });
  if (ghostCookieValue) {
    res.cookies.set(GHOST_COOKIE_NAME, ghostCookieValue, GHOST_COOKIE_OPTIONS);
  }
  return res;
}
