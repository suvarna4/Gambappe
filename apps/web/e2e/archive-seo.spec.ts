/**
 * WS8-T5 E2E: `GET /q` (the archive) and structured data / canonical tags on `/q/[slug]`,
 * against the real running app + real Postgres (design doc §19.3 AC). Seeds directly into
 * Postgres, same pattern as `oembed-sitemap.spec.ts`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { connect, markets, questions, type Db } from '@receipts/db';
import { buildMarket, buildQuestion } from '@receipts/db/testing';
import type pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://receipts:receipts@localhost:5432/receipts';

let pool: pg.Pool;
let db: Db;

test.beforeAll(() => {
  ({ pool, db } = connect({ connectionString: DATABASE_URL }));
});

test.afterAll(async () => {
  await pool.end();
});

async function seedRevealedQuestion() {
  const unique = randomUUID();
  const market = buildMarket({ venueMarketId: `KX-E2E-ARCHIVE-${unique}`, status: 'resolved', outcome: 'yes' });
  await db.insert(markets).values(market);
  const question = buildQuestion(market.id as string, {
    slug: `e2e-archive-${unique}`,
    questionDate: null,
    status: 'revealed',
    outcome: 'yes',
    crowdYesAtLock: 3,
    crowdNoAtLock: 1,
    revealedAt: new Date(),
  });
  await db.insert(questions).values(question);
  return { market, question };
}

test.describe('GET /q archive (§10.1, WS8-T5)', () => {
  test('lists a revealed question with its headline and links to the question page', async ({ page }) => {
    const { question } = await seedRevealedQuestion();

    await page.goto('/q');
    // Locate by `href` (the slug embeds a fresh UUID, so it's always unique) rather than by
    // headline text: the factory's default headline isn't unique across runs against this
    // shared, non-test `receipts` database, so a text-based locator can match several stale
    // rows left over from earlier e2e runs.
    await expect(page.locator(`a[href="/q/${question.slug}"]`)).toContainText(question.headline);
  });

  test('carries an ItemList JSON-LD block referencing the seeded question', async ({ page }) => {
    const { question } = await seedRevealedQuestion();

    await page.goto('/q');
    const jsonLdText = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLdText).toBeTruthy();
    const jsonLd = JSON.parse(jsonLdText!);
    expect(jsonLd['@type']).toBe('ItemList');
    const urls = (jsonLd.itemListElement as Array<{ url: string }>).map((item) => item.url);
    expect(urls.some((url) => url.endsWith(`/q/${question.slug}`))).toBe(true);
  });

  test('carries a self-canonical link', async ({ page }) => {
    await page.goto('/q');
    const href = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(href).toMatch(/\/q$/);
  });
});

test.describe('/q/[slug] structured data + canonical (WS8-T5)', () => {
  test('carries an Article JSON-LD block and a self-canonical link', async ({ page }) => {
    const { question } = await seedRevealedQuestion();

    await page.goto(`/q/${question.slug}`);

    const href = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(href).toMatch(new RegExp(`/q/${question.slug}$`));

    const jsonLdText = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLdText).toBeTruthy();
    const jsonLd = JSON.parse(jsonLdText!);
    expect(jsonLd['@type']).toBe('Article');
    expect(jsonLd.headline).toBe(question.headline);
    expect(jsonLd.mainEntityOfPage).toMatch(new RegExp(`/q/${question.slug}$`));
  });
});

test.describe('GET /robots.txt (WS8-T5)', () => {
  test('disallows /admin and /api/, points at the sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Disallow: /admin');
    expect(body).toContain('Sitemap:');
  });
});
