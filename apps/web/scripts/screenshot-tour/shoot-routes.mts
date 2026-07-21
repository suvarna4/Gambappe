/** Throwaway route screenshotter (not committed). */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = process.env.SHOT_DIR ?? '/tmp/claude-0/screens';
mkdirSync(OUT, { recursive: true });

const pairingId = process.env.PAIRING_ID ?? '';
const duoId = process.env.DUO_ID ?? '';

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const routes: Array<{
  path: string;
  name: string;
  viewport?: { width: number; height: number };
  full?: boolean;
}> = [
  { path: '/', name: '01-home-today' },
  { path: `/q/2026-07-21-alcaraz-wimbledon-final`, name: '02-question-open' },
  { path: `/q/2026-07-20-fed-holds-july`, name: '03-question-revealed' },
  { path: '/q', name: '04-archive' },
  { path: '/p/fox-4821', name: '05-profile', full: true },
  { path: `/vs/${pairingId}`, name: '06-vs-matchup', full: true },
  { path: '/nemesis', name: '07-nemesis', full: true },
  { path: '/nemesis/matchup', name: '08-nemesis-matchup', full: true },
  { path: '/nemesis/history', name: '09-nemesis-history', full: true },
  { path: '/duo', name: '10-duo-hub', full: true },
  { path: `/duos/${duoId}`, name: '11-duo-public', full: true },
  { path: '/ladder', name: '12-ladder', full: true },
  { path: '/claim', name: '13-claim', full: true },
  { path: '/placement', name: '14-placement' },
  { path: '/settings', name: '15-settings', full: true },
  { path: '/dev/ui', name: '16-dev-ui-gallery', viewport: DESKTOP, full: true },
  { path: '/admin', name: '17-admin', viewport: DESKTOP },
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
for (const r of routes) {
  const ctx = await browser.newContext({ viewport: r.viewport ?? MOBILE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    const resp = await page.goto(`http://localhost:3000${r.path}`, {
      waitUntil: 'networkidle',
      timeout: 45_000,
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${r.name}.png`, fullPage: r.full ?? false });
    console.log(
      `${r.name}: HTTP ${resp?.status()} → ${page.url()}${errors.length ? ` [pageerrors: ${errors.length}]` : ''}`,
    );
  } catch (e) {
    console.log(`${r.name}: FAILED ${String(e).slice(0, 140)}`);
  }
  await ctx.close();
}
await browser.close();
