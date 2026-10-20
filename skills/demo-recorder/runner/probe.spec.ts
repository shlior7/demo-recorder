import { test } from '@playwright/test';

// `record-demo.sh probe` — dump what's on screen so locators can be picked for an unfamiliar app.
test('probe', async ({ page }) => {
  await page.goto(process.env.DEMO_BASE_URL!);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log(`URL: ${page.url()}\nTITLE: ${await page.title()}\n`);
  console.log(await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: process.env.DEMO_PROBE_SHOT! });
});
