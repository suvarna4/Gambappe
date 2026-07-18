import "dotenv/config";
import { db } from "../src/db/client";
import { users, markets, questions } from "../src/db/schema";
import { etDateTimeToUtc, etDateStr } from "../src/shared/time";
import { CONSTANTS } from "../src/shared/constants";

/** M1 seed script: dev users, one FakeVenue market, one open daily question. */
async function main() {
  const today = etDateStr(new Date());

  const [alice] = await db
    .insert(users)
    .values({ kind: "claimed", handle: "alice-demo" })
    .onConflictDoNothing({ target: users.handle })
    .returning();
  const [bob] = await db
    .insert(users)
    .values({ kind: "claimed", handle: "bob-demo" })
    .onConflictDoNothing({ target: users.handle })
    .returning();

  const [market] = await db
    .insert(markets)
    .values({
      venue: "fake",
      venueMarketId: "fake:question-zero",
      title: "Will Argentina win the World Cup final?",
      category: "sports",
      yesLabel: "Argentina wins",
      noLabel: "Argentina doesn't win",
      url: "https://kalshi.com/markets/fake-question-zero",
      lastPriceYes: "0.58",
      priceUpdatedAt: new Date(),
    })
    .returning();

  const opensAt = new Date(Date.now() - 3600_000);
  const locksAt = new Date(Date.now() + 3600_000);

  const [question] = await db
    .insert(questions)
    .values({
      marketId: market.id,
      kind: "daily",
      questionDate: today,
      opensAt,
      locksAt,
      status: "open",
      headline: "Will Argentina win the World Cup final?",
    })
    .returning();

  console.log("Seeded:", { alice: alice?.handle, bob: bob?.handle, market: market.id, question: question.id });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
