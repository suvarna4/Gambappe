/**
 * Throwaway seed for route screenshots (not committed): today's open daily, yesterday's
 * revealed daily, public profiles, a nemesis pairing for /vs, and a duo for /duos + /ladder.
 */
import { eq } from 'drizzle-orm';
import {
  connect,
  duos,
  markets,
  nemesisPairings,
  pairingQuestions,
  picks,
  profiles,
  questions,
  seasons,
} from '@receipts/db';
import {
  buildDuo,
  buildGradedQuestionScenario,
  buildMarket,
  buildNemesisPairing,
  buildPick,
  buildProfile,
  buildQuestion,
  buildSeason,
  computeEdge,
} from '@receipts/db/testing';

const { pool, db } = connect();

function etDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const now = Date.now();
const today = etDate(0);
const yesterday = etDate(-1);

try {
  // Idempotency: if a prior run already seeded the tour fixtures, report them and stop.
  const [existingFox] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.slug, 'fox-4821'))
    .limit(1);
  if (existingFox) {
    const [pairing] = await db.select().from(nemesisPairings).limit(1);
    const [duo] = await db.select().from(duos).where(eq(duos.profileAId, existingFox.id)).limit(1);
    console.log(
      JSON.stringify(
        {
          alreadySeeded: true,
          todaySlug: `${today}-alcaraz-wimbledon-final`,
          revealedSlug: `${yesterday}-fed-holds-july`,
          profileSlug: existingFox.slug,
          pairingId: pairing?.id ?? null,
          duoId: duo?.id ?? null,
        },
        null,
        1,
      ),
    );
    process.exit(0);
  }

  // --- 1. Today's open headliner -----------------------------------------------------------
  const openMarket = buildMarket({
    venueMarketId: 'KX-WIMBLEDON-FINAL',
    title: 'Wimbledon men’s final: Alcaraz to win?',
    category: 'sports',
    yesPrice: 0.58,
    closeTime: new Date(now + 6 * 3600_000),
  });
  await db.insert(markets).values(openMarket);
  const openQuestion = buildQuestion(openMarket.id as string, {
    questionDate: today,
    slug: `${today}-alcaraz-wimbledon-final`,
    headline: 'Will Alcaraz beat Sinner in the Wimbledon final?',
    openAt: new Date(now - 2 * 3600_000),
    lockAt: new Date(now + 4 * 3600_000),
    revealAt: new Date(now + 10 * 3600_000),
    status: 'open',
  });
  await db.insert(questions).values(openQuestion);

  // --- 2. Yesterday's revealed daily (archive + /q/[slug] revealed state) -------------------
  const scenario = buildGradedQuestionScenario({ questionDate: yesterday });
  scenario.market.title = 'Fed holds rates at the July meeting?';
  scenario.market.category = 'economics';
  scenario.question.headline = 'Will the Fed hold rates in July?';
  scenario.question.slug = `${yesterday}-fed-holds-july`;
  await db.insert(markets).values(scenario.market);
  await db.insert(questions).values(scenario.question);
  await db.insert(profiles).values(scenario.profiles);
  await db.insert(picks).values(scenario.picks);

  // --- 3. Named claimed profiles (public profile page + rivals) -----------------------------
  const fox = buildProfile({ kind: 'claimed', handle: 'Fox #4821', slug: 'fox-4821' });
  const wolf = buildProfile({ kind: 'claimed', handle: 'Wolf #1180', slug: 'wolf-1180' });
  const otter = buildProfile({ kind: 'claimed', handle: 'Otter #7742', slug: 'otter-7742' });
  await db.insert(profiles).values([fox, wolf, otter]);
  const gradedAt = new Date(now - 20 * 3600_000);
  await db.insert(picks).values([
    buildPick(scenario.question.id as string, fox.id as string, {
      side: 'yes',
      yesPriceAtEntry: 0.6,
      result: 'win',
      edge: computeEdge('yes', 0.6, true),
      gradedAt,
    }),
    buildPick(scenario.question.id as string, wolf.id as string, {
      side: 'yes',
      yesPriceAtEntry: 0.66,
      result: 'win',
      edge: computeEdge('yes', 0.66, true),
      gradedAt,
    }),
  ]);

  // --- 4. Nemesis pairing (public /vs/[pairingId]) ------------------------------------------
  const [a, b] = [fox, wolf].sort((x, y) => String(x.id).localeCompare(String(y.id)));
  const season = buildSeason({ startsOn: '2026-07-06', endsOn: '2026-09-28', name: 'Season 1' });
  await db.insert(seasons).values(season);
  const pairing = buildNemesisPairing(season.id as string, a.id as string, b.id as string, {
    weekStart: '2026-07-20',
    status: 'active',
    scoreA: 2,
    scoreB: 3,
    winnerProfileId: null,
    verdict: null,
  });
  await db.insert(nemesisPairings).values(pairing);
  await db.insert(pairingQuestions).values([
    { pairingId: pairing.id as string, questionId: openQuestion.id as string },
    { pairingId: pairing.id as string, questionId: scenario.question.id as string },
  ]);

  // --- 5. Duo + ladder ----------------------------------------------------------------------
  const duo = buildDuo(fox.id as string, otter.id as string, {
    tier: 3,
    glickoRating: 1580,
    matchesPlayed: 6,
  });
  const rivalDuo = buildDuo(wolf.id as string, scenario.profiles[0].id as string, {
    tier: 3,
    glickoRating: 1544,
    matchesPlayed: 6,
  });
  await db.insert(duos).values([duo, rivalDuo]);

  const counts = await db.select({ id: questions.id }).from(questions);
  console.log(
    JSON.stringify(
      {
        questions: counts.length,
        todaySlug: openQuestion.slug,
        revealedSlug: scenario.question.slug,
        profileSlug: fox.slug,
        pairingId: pairing.id,
        duoId: duo.id,
      },
      null,
      1,
    ),
  );
} finally {
  await pool.end();
}
