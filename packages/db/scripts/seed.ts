/**
 * Seed script (WS0-T3): admin user, a nemesis season, dev-fixture placement items.
 *
 * - Admin users are set only via seed/ops (§15.1); ADMIN_SEED_EMAIL is dev/staging only (App. B).
 * - REACTION_SET is a constant in @receipts/core config — nothing to seed for it (§5.6).
 * - placement_items here are DEV FIXTURES ONLY, clearly marked; production content (≥15
 *   curated rows) is owned solely by WS4-T8 (§5.5).
 *
 * Idempotent: safe to run repeatedly.
 */
import { uuidv7 } from 'uuidv7';
import { eq, like } from 'drizzle-orm';
import { NEMESIS_SEASON_WEEKS, SCHEDULE_TZ } from '@receipts/core';
import { connect } from '../src/client.js';
import { seedCpuRoster } from '../src/repositories/cpu.js';
import { placementItems, seasons, users } from '../src/schema/index.js';

const { pool, db } = connect();

/** Monday (ET) of the week containing `now`, as YYYY-MM-DD. */
function currentEtMonday(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const offsetDays = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
  const etMidnightUtc = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  etMidnightUtc.setUTCDate(etMidnightUtc.getUTCDate() - offsetDays);
  return etMidnightUtc.toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

try {
  // --- Admin user (dev/staging only) ---------------------------------------------------------
  const adminEmail = process.env.ADMIN_SEED_EMAIL;
  if (adminEmail) {
    const existing = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existing.length === 0) {
      await db.insert(users).values({
        id: uuidv7(),
        email: adminEmail,
        role: 'admin',
        ageAttestedAt: new Date(),
      });
      console.log(`seeded admin user ${adminEmail}`);
    } else if (existing[0] && existing[0].role !== 'admin') {
      await db.update(users).set({ role: 'admin' }).where(eq(users.email, adminEmail));
      console.log(`promoted ${adminEmail} to admin`);
    }
  } else {
    console.log('ADMIN_SEED_EMAIL not set — skipping admin user (fine outside dev/staging)');
  }

  // --- Nemesis season (12 weeks from this week's ET Monday, §5.4) ----------------------------
  const startsOn = currentEtMonday(new Date());
  const endsOn = addDays(startsOn, NEMESIS_SEASON_WEEKS * 7 - 1);
  const existingSeason = await db
    .select()
    .from(seasons)
    .where(eq(seasons.startsOn, startsOn))
    .limit(1);
  if (existingSeason.length === 0) {
    await db.insert(seasons).values({
      id: uuidv7(),
      kind: 'nemesis',
      startsOn,
      endsOn,
      name: `Nemesis Season (${startsOn})`,
    });
    console.log(`seeded nemesis season ${startsOn} → ${endsOn}`);
  }

  // --- Dev-fixture placement items (§5.5 — NOT production content, WS4-T8 owns that) ---------
  const DEV_PREFIX = '[DEV FIXTURE] ';
  const devItems = [
    {
      title: 'Did the favorite win the 2024 World Series?',
      category: 'sports' as const,
      yesLabel: 'Favorite won',
      noLabel: 'Underdog won',
      historicalYesPrice: 0.62,
      historicalCrowdYesPct: 71,
      outcome: 'yes' as const,
      resolvedOn: '2024-10-31',
    },
    {
      title: 'Did turnout exceed 60% in the 2024 US election?',
      category: 'politics' as const,
      yesLabel: 'Over 60%',
      noLabel: 'Under 60%',
      historicalYesPrice: 0.55,
      historicalCrowdYesPct: 64,
      outcome: 'yes' as const,
      resolvedOn: '2024-11-06',
    },
    {
      title: 'Was there a US recession declared in 2024?',
      category: 'economics' as const,
      yesLabel: 'Recession',
      noLabel: 'No recession',
      historicalYesPrice: 0.3,
      historicalCrowdYesPct: 41,
      outcome: 'no' as const,
      resolvedOn: '2024-12-31',
    },
    {
      title: 'Did the #1 album of 2024 come from a debut artist?',
      category: 'culture' as const,
      yesLabel: 'Debut artist',
      noLabel: 'Established artist',
      historicalYesPrice: 0.18,
      historicalCrowdYesPct: 25,
      outcome: 'no' as const,
      resolvedOn: '2024-12-15',
    },
    {
      title: 'Did a private lunar lander touch down intact in 2024?',
      category: 'science' as const,
      yesLabel: 'Intact landing',
      noLabel: 'No intact landing',
      historicalYesPrice: 0.45,
      historicalCrowdYesPct: 52,
      outcome: 'yes' as const,
      resolvedOn: '2024-02-22',
    },
    {
      title: 'Did any city break its all-time heat record in summer 2024?',
      category: 'science' as const,
      yesLabel: 'Record broken',
      noLabel: 'No record',
      historicalYesPrice: 0.78,
      historicalCrowdYesPct: 83,
      outcome: 'yes' as const,
      resolvedOn: '2024-09-01',
    },
  ];

  const existingDev = await db
    .select({ id: placementItems.id })
    .from(placementItems)
    .where(like(placementItems.title, `${DEV_PREFIX}%`));
  if (existingDev.length === 0) {
    await db.insert(placementItems).values(
      devItems.map((item) => ({
        id: uuidv7(),
        ...item,
        title: `${DEV_PREFIX}${item.title}`,
        active: true,
      })),
    );
    console.log(`seeded ${devItems.length} dev-fixture placement items`);
  }

  // --- Production placement content (§5.5, WS4-T8): ≥15 curated rows, ≥3 categories ----------
  // Owned solely by WS4-T8 per §5.5 ("Production content (≥15 curated rows) is owned solely by
  // WS4-T8; WS0-T3's seed includes only clearly-marked dev fixtures for these rows" — the dev
  // block above). Real-feeling historical questions with plausible price/crowd data; not tied
  // to any specific venue market. Idempotent via a title existence probe, same pattern as the
  // admin user / season blocks above.
  const productionPlacementItems = [
    // sports
    {
      title: "Did the #1 overall seed win the 2023 NCAA men's basketball tournament?",
      category: 'sports' as const,
      yesLabel: '#1 seed champion',
      noLabel: 'Lower seed champion',
      historicalYesPrice: 0.24,
      historicalCrowdYesPct: 33,
      outcome: 'no' as const,
      resolvedOn: '2023-04-03',
    },
    {
      title: 'Did the reigning champion repeat as Super Bowl winner after the 2022 NFL season?',
      category: 'sports' as const,
      yesLabel: 'Repeat champion',
      noLabel: 'New champion',
      historicalYesPrice: 0.18,
      historicalCrowdYesPct: 22,
      outcome: 'no' as const,
      resolvedOn: '2023-02-12',
    },
    {
      title: 'Did a European club win the 2023 FIFA Club World Cup?',
      category: 'sports' as const,
      yesLabel: 'European club',
      noLabel: 'Non-European club',
      historicalYesPrice: 0.7,
      historicalCrowdYesPct: 75,
      outcome: 'yes' as const,
      resolvedOn: '2023-12-22',
    },
    // politics
    {
      title: 'Did the incumbent party retain the White House in the 2024 US presidential election?',
      category: 'politics' as const,
      yesLabel: 'Incumbent party wins',
      noLabel: 'Opposition wins',
      historicalYesPrice: 0.46,
      historicalCrowdYesPct: 50,
      outcome: 'no' as const,
      resolvedOn: '2024-11-06',
    },
    {
      title: 'Did voter turnout exceed 60% of eligible voters in the 2024 US general election?',
      category: 'politics' as const,
      yesLabel: 'Over 60%',
      noLabel: 'Under 60%',
      historicalYesPrice: 0.55,
      historicalCrowdYesPct: 60,
      outcome: 'yes' as const,
      resolvedOn: '2024-11-06',
    },
    {
      title: 'Did control of the US Senate flip parties after the 2024 election?',
      category: 'politics' as const,
      yesLabel: 'Senate flipped',
      noLabel: 'Senate held',
      historicalYesPrice: 0.6,
      historicalCrowdYesPct: 65,
      outcome: 'yes' as const,
      resolvedOn: '2024-11-06',
    },
    // economics
    {
      title: 'Did the US Federal Reserve cut interest rates in 2024?',
      category: 'economics' as const,
      yesLabel: 'Rate cut',
      noLabel: 'No rate cut',
      historicalYesPrice: 0.72,
      historicalCrowdYesPct: 78,
      outcome: 'yes' as const,
      resolvedOn: '2024-12-18',
    },
    {
      title: 'Was a US recession officially declared in 2023?',
      category: 'economics' as const,
      yesLabel: 'Recession declared',
      noLabel: 'No recession',
      historicalYesPrice: 0.25,
      historicalCrowdYesPct: 30,
      outcome: 'no' as const,
      resolvedOn: '2023-12-31',
    },
    {
      title: 'Did US annual inflation (CPI) fall below 3% at any point in 2024?',
      category: 'economics' as const,
      yesLabel: 'Below 3%',
      noLabel: 'Stayed at/above 3%',
      historicalYesPrice: 0.58,
      historicalCrowdYesPct: 62,
      outcome: 'yes' as const,
      resolvedOn: '2024-09-30',
    },
    // culture
    {
      title: 'Did a sequel top the annual US box office in 2023?',
      category: 'culture' as const,
      yesLabel: 'Sequel #1',
      noLabel: 'Original film #1',
      historicalYesPrice: 0.4,
      historicalCrowdYesPct: 45,
      outcome: 'no' as const,
      resolvedOn: '2023-12-31',
    },
    {
      title: "Did 'Oppenheimer' win Best Picture at the 2024 Academy Awards?",
      category: 'culture' as const,
      yesLabel: 'Oppenheimer wins',
      noLabel: 'Another film wins',
      historicalYesPrice: 0.75,
      historicalCrowdYesPct: 80,
      outcome: 'yes' as const,
      resolvedOn: '2024-03-10',
    },
    {
      title:
        "Did Taylor Swift's 'The Tortured Poets Department' debut at #1 on the Billboard 200 in 2024?",
      category: 'culture' as const,
      yesLabel: 'Debuted at #1',
      noLabel: 'Did not debut at #1',
      historicalYesPrice: 0.88,
      historicalCrowdYesPct: 92,
      outcome: 'yes' as const,
      resolvedOn: '2024-04-19',
    },
    // science
    {
      title: 'Did a private company achieve a soft landing on the Moon in 2024?',
      category: 'science' as const,
      yesLabel: 'Soft landing achieved',
      noLabel: 'No soft landing',
      historicalYesPrice: 0.42,
      historicalCrowdYesPct: 48,
      outcome: 'yes' as const,
      resolvedOn: '2024-02-22',
    },
    {
      title: 'Was 2023 confirmed as the hottest year on record globally?',
      category: 'science' as const,
      yesLabel: 'Hottest on record',
      noLabel: 'Not a record',
      historicalYesPrice: 0.8,
      historicalCrowdYesPct: 85,
      outcome: 'yes' as const,
      resolvedOn: '2024-01-09',
    },
    {
      title: 'Did the WHO declare an end to the COVID-19 global health emergency in 2023?',
      category: 'science' as const,
      yesLabel: 'Emergency ended',
      noLabel: 'Emergency continued',
      historicalYesPrice: 0.65,
      historicalCrowdYesPct: 70,
      outcome: 'yes' as const,
      resolvedOn: '2023-05-05',
    },
    // other
    {
      title: 'Did Twitter rebrand under a new name in 2023?',
      category: 'other' as const,
      yesLabel: 'Renamed',
      noLabel: 'Kept the old name',
      historicalYesPrice: 0.55,
      historicalCrowdYesPct: 60,
      outcome: 'yes' as const,
      resolvedOn: '2023-07-24',
    },
    {
      title: 'Did OpenAI release a major new flagship model in 2023?',
      category: 'other' as const,
      yesLabel: 'New flagship released',
      noLabel: 'No new flagship',
      historicalYesPrice: 0.85,
      historicalCrowdYesPct: 88,
      outcome: 'yes' as const,
      resolvedOn: '2023-03-14',
    },
    {
      title: 'Did several major US tech companies announce mass layoffs in early 2023?',
      category: 'other' as const,
      yesLabel: 'Layoffs announced',
      noLabel: 'No major layoffs',
      historicalYesPrice: 0.82,
      historicalCrowdYesPct: 87,
      outcome: 'yes' as const,
      resolvedOn: '2023-01-31',
    },
  ];

  const firstProd = productionPlacementItems[0];
  const existingProd = firstProd
    ? await db
        .select({ id: placementItems.id })
        .from(placementItems)
        .where(eq(placementItems.title, firstProd.title))
    : [];
  if (existingProd.length === 0) {
    await db.insert(placementItems).values(
      productionPlacementItems.map((item) => ({
        id: uuidv7(),
        ...item,
        active: true,
      })),
    );
    console.log(`seeded ${productionPlacementItems.length} production placement items`);
  }

  // WS26-T3: CPU nemesis roster (idempotent by slug). Inert until FLAG_CPU_NEMESIS is on
  // and the WS26-T4/T5 jobs land — seeding everywhere is safe by construction.
  const cpuIds = await seedCpuRoster(db, new Date());
  console.log(`cpu roster present: ${Object.keys(cpuIds).length} personas`);

  console.log('seed complete');
} finally {
  await pool.end();
}
