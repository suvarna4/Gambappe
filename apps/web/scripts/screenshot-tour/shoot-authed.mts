/** Throwaway: screenshot auth-gated routes as the signed-in Fox profile. */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = '/tmp/claude-0/screens';
mkdirSync(OUT, { recursive: true });
const token = process.env.SESSION_TOKEN!;

const routes = [{ path: '/claim', name: '19-claim-signed-in', full: true }];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
await ctx.addCookies([
  {
    name: 'authjs.session-token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  },
]);
for (const r of routes) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(`http://localhost:3000${r.path}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${r.name}.png`, fullPage: r.full ?? false });
    console.log(`${r.name}: HTTP ${resp?.status()} → ${page.url()}`);
  } catch (e) {
    console.log(`${r.name}: FAILED ${String(e).slice(0, 120)}`);
  }
  await page.close();
}
await browser.close();
