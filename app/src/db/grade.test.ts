import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./client";
import { users, markets, questions, picks, userStats } from "./schema";
import { gradeQuestion, revealQuestion, lockDueQuestion } from "./grade";
import { eq, sql } from "drizzle-orm";

async function makeUser(handle: string) {
  const [u] = await db.insert(users).values({ kind: "claimed", handle }).returning();
  return u;
}

async function makeMarketAndQuestion(opts: {
  questionDate: string;
  opensAt: Date;
  locksAt: Date;
  status?: "open" | "locked";
  lastPriceYes?: string;
}) {
  const [m] = await db
    .insert(markets)
    .values({
      venue: "fake",
      venueMarketId: `fake-${crypto.randomUUID()}`,
      title: "Test market",
      category: "sports",
      yesLabel: "Yes",
      noLabel: "No",
      url: "https://example.test",
      lastPriceYes: opts.lastPriceYes ?? "0.6",
      priceUpdatedAt: new Date(),
    })
    .returning();
  const [q] = await db
    .insert(questions)
    .values({
      marketId: m.id,
      kind: "daily",
      questionDate: opts.questionDate,
      opensAt: opts.opensAt,
      locksAt: opts.locksAt,
      status: opts.status ?? "open",
      headline: "Will it happen?",
    })
    .returning();
  return { market: m, question: q };
}

describe("gradeQuestion (§5.5) integration", () => {
  beforeEach(async () => {
    // Clean slate per test — simple truncate in dependency order.
    await db.execute(sql`truncate table picks, user_stats, questions, markets, users cascade`);
  });

  it("grades picks correctly and is idempotent on retry", async () => {
    const alice = await makeUser("alice-test");
    const bob = await makeUser("bob-test");
    const { question } = await makeMarketAndQuestion({
      questionDate: "2026-07-18",
      opensAt: new Date(Date.now() - 3600_000),
      locksAt: new Date(Date.now() - 60_000),
      status: "locked",
    });
    await db.insert(picks).values([
      { questionId: question.id, userId: alice.id, side: "yes", entryPrice: "0.6", entryPriceAt: new Date() },
      { questionId: question.id, userId: bob.id, side: "no", entryPrice: "0.4", entryPriceAt: new Date() },
    ]);

    const now = new Date();
    const r1 = await gradeQuestion(question.id, { outcome: "yes", settledAt: now }, now);
    expect(r1.graded).toBe(true);

    const alicePick = await db.select().from(picks).where(eq(picks.userId, alice.id));
    const bobPick = await db.select().from(picks).where(eq(picks.userId, bob.id));
    expect(alicePick[0].result).toBe("win");
    expect(bobPick[0].result).toBe("loss");

    const [q1] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(q1.status).toBe("graded");

    // Idempotency: run again, nothing changes (status is no longer open/locked).
    const r2 = await gradeQuestion(question.id, { outcome: "yes", settledAt: now }, new Date());
    expect(r2.graded).toBe(false);
    const [q2] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(q2.gradedAt?.getTime()).toBe(q1.gradedAt?.getTime());
  });

  it("early settlement: an OPEN question locks-and-grades in one step, no post-resolution picks possible", async () => {
    const alice = await makeUser("alice-early");
    const { question } = await makeMarketAndQuestion({
      questionDate: "2026-07-18",
      opensAt: new Date(Date.now() - 3600_000),
      locksAt: new Date(Date.now() + 3600_000), // scheduled lock is in the FUTURE
      status: "open",
    });
    await db
      .insert(picks)
      .values({ questionId: question.id, userId: alice.id, side: "yes", entryPrice: "0.6", entryPriceAt: new Date() });

    const now = new Date();
    const result = await gradeQuestion(question.id, { outcome: "yes", settledAt: now }, now);
    expect(result.graded).toBe(true);

    const [q] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(q.status).toBe("graded"); // went straight from open -> locked -> graded
    expect(q.lockedAt).not.toBeNull();
    expect(q.crowdYesAtLock).toBe(1);
  });

  it("void: picks become void and question skips graded/revealed entirely", async () => {
    const alice = await makeUser("alice-void");
    const { question } = await makeMarketAndQuestion({
      questionDate: "2026-07-18",
      opensAt: new Date(Date.now() - 3600_000),
      locksAt: new Date(Date.now() - 60_000),
      status: "locked",
    });
    await db
      .insert(picks)
      .values({ questionId: question.id, userId: alice.id, side: "yes", entryPrice: "0.6", entryPriceAt: new Date() });

    const now = new Date();
    const result = await gradeQuestion(question.id, { outcome: "void", settledAt: now }, now);
    expect(result.voided).toBe(true);

    const [q] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(q.status).toBe("voided");
    const [p] = await db.select().from(picks).where(eq(picks.userId, alice.id));
    expect(p.result).toBe("void");
  });

  it("revealQuestion only recomputes stats and flips status once graded", async () => {
    const alice = await makeUser("alice-reveal");
    const { question } = await makeMarketAndQuestion({
      questionDate: "2026-07-18",
      opensAt: new Date(Date.now() - 3600_000),
      locksAt: new Date(Date.now() - 60_000),
      status: "locked",
    });
    await db
      .insert(picks)
      .values({ questionId: question.id, userId: alice.id, side: "yes", entryPrice: "0.2", entryPriceAt: new Date() });

    const now = new Date();
    await gradeQuestion(question.id, { outcome: "yes", settledAt: now }, now);

    // Not revealed yet -> reveal should no-op if we haven't graded... but we HAVE graded, so it should work.
    const revealed = await revealQuestion(question.id, new Date());
    expect(revealed).toBe(true);

    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, alice.id));
    expect(stats.wins).toBe(1);
    expect(stats.winStreak).toBe(1);
    expect(Number(stats.edgeSum)).toBeCloseTo(0.8, 5);

    const [q] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(q.status).toBe("revealed");

    // Second reveal call is a no-op (already revealed).
    const revealedAgain = await revealQuestion(question.id, new Date());
    expect(revealedAgain).toBe(false);
  });

  it("lockDueQuestion snapshots price and bot-excluded crowd counts", async () => {
    const alice = await makeUser("alice-lock");
    const bot = await db
      .insert(users)
      .values({ kind: "ghost", handle: "bot-account", botSuspect: true })
      .returning();
    const { question } = await makeMarketAndQuestion({
      questionDate: "2026-07-18",
      opensAt: new Date(Date.now() - 3600_000),
      locksAt: new Date(Date.now() - 1000),
      status: "open",
      lastPriceYes: "0.71",
    });
    await db.insert(picks).values([
      { questionId: question.id, userId: alice.id, side: "yes", entryPrice: "0.71", entryPriceAt: new Date() },
      { questionId: question.id, userId: bot[0].id, side: "yes", entryPrice: "0.71", entryPriceAt: new Date() },
    ]);

    await lockDueQuestion(question.id, new Date());

    const [q] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(q.status).toBe("locked");
    expect(q.priceYesAtLock).toBe("0.71000");
    expect(q.crowdYesAtLock).toBe(1); // bot excluded
  });
});
