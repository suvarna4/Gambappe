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

  console.log('seed complete');
} finally {
  await pool.end();
}
