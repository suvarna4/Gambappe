import { and, eq, lte, inArray } from "drizzle-orm";
import { db } from "./client";
import { questions, markets } from "./schema";
import { lockDueQuestion, gradeQuestion, revealQuestion } from "./grade";
import { updateNemesisPairingsOnReveal } from "./nemesis";
import { getAdapter } from "@/venues";
import { CONSTANTS } from "@/shared/constants";

/**
 * §16.3 cron sweep, run by GET /api/cron/tick: poll prices -> open/lock
 * due questions -> check resolutions -> grade -> flip due reveals.
 * Every step is status-keyed exactly as in §5.5, so overlapping ticks
 * are harmless (idempotent).
 */
export async function runCronTick(now: Date = new Date()): Promise<{
  pricesPolled: number;
  opened: number;
  locked: number;
  graded: number;
  revealed: number;
}> {
  const pricesPolled = await pollPrices(now);
  const opened = await openDueQuestions(now);
  const locked = await lockDueQuestions(now);
  const graded = await checkSettlements(now);
  const revealed = await revealDueQuestions(now);
  return { pricesPolled, opened, locked, graded, revealed };
}

async function pollPrices(now: Date): Promise<number> {
  const nonTerminal = await db
    .selectDistinct({ marketId: questions.marketId })
    .from(questions)
    .where(inArray(questions.status, ["draft", "open", "locked"]));

  let count = 0;
  for (const { marketId } of nonTerminal) {
    const [market] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
    if (!market || market.status !== "active") continue;
    const adapter = getAdapter(market.venue);
    const price = await adapter.getPrice(market.venueMarketId);
    if (!price) continue;
    await db
      .update(markets)
      .set({ lastPriceYes: String(price.priceYes), priceUpdatedAt: price.observedAt })
      .where(eq(markets.id, marketId));
    count++;
  }
  return count;
}

async function openDueQuestions(now: Date): Promise<number> {
  const due = await db
    .select({ id: questions.id, marketId: questions.marketId })
    .from(questions)
    .where(and(eq(questions.status, "draft"), lte(questions.opensAt, now)));

  let count = 0;
  for (const q of due) {
    const [market] = await db.select().from(markets).where(eq(markets.id, q.marketId)).limit(1);
    const fresh =
      market?.priceUpdatedAt &&
      now.getTime() - market.priceUpdatedAt.getTime() <= CONSTANTS.PRICE_MAX_STALENESS_SEC * 1000;
    if (!fresh) continue; // §5.2: a question must never open unpriced
    await db.update(questions).set({ status: "open" }).where(eq(questions.id, q.id));
    count++;
  }
  return count;
}

async function lockDueQuestions(now: Date): Promise<number> {
  const openQuestions = await db
    .select({ id: questions.id, locksAt: questions.locksAt, marketId: questions.marketId })
    .from(questions)
    .where(eq(questions.status, "open"));

  let count = 0;
  for (const q of openQuestions) {
    const [market] = await db.select().from(markets).where(eq(markets.id, q.marketId)).limit(1);
    const deadline =
      market?.closeTime && market.closeTime.getTime() < q.locksAt.getTime()
        ? market.closeTime
        : q.locksAt;
    if (deadline.getTime() <= now.getTime()) {
      await lockDueQuestion(q.id, now);
      count++;
    }
  }
  return count;
}

async function checkSettlements(now: Date): Promise<number> {
  const candidates = await db
    .select({ id: questions.id, marketId: questions.marketId })
    .from(questions)
    .where(inArray(questions.status, ["open", "locked"]));

  let count = 0;
  for (const q of candidates) {
    const [market] = await db.select().from(markets).where(eq(markets.id, q.marketId)).limit(1);
    if (!market || market.status !== "active") continue;
    const adapter = getAdapter(market.venue);
    const resolution = await adapter.getResolution(market.venueMarketId);
    if (!resolution) continue;
    const result = await gradeQuestion(q.id, resolution, now);
    if (result.graded || result.voided) count++;
  }
  return count;
}

async function revealDueQuestions(now: Date): Promise<number> {
  const due = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(eq(questions.status, "graded"), lte(questions.revealAt, now))
    );
  let count = 0;
  for (const q of due) {
    const ok = await revealQuestion(q.id, now);
    if (ok) {
      count++;
      await updateNemesisPairingsOnReveal(q.id, now);
    }
  }
  return count;
}
