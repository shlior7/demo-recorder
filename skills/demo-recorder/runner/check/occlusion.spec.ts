import { test, expect } from '@playwright/test';
import { callout } from '../demo-recorder';

// Regression: a target scrolled under a sticky header must be revealed before the callout is drawn.
// Run from runner/ (Playwright installed, e.g. node_modules linked to ~/.demo-recorder's):
//   DEMO_TEST_DIR=$PWD/check DEMO_NO_VIDEO=1 npx playwright test --config playwright.config.ts
const html = (scrollY: number) => `data:text/html,<body style="margin:0;height:3000px">
<header style="position:sticky;top:0;z-index:10;height:80px;background:%23333">Sticky bar</header>
<h2 id=t style="position:absolute;top:1000px;left:100px;margin:0;height:40px">Execution timeline</h2>
<script>scrollTo(0,${scrollY})</script></body>`;

const ringRect = (page) =>
  page.evaluate(() => document.querySelector('#demo-callouts div[style*="border-radius: 10px"]')!.getBoundingClientRect().toJSON());

test('callout ring lands on the target, not the sticky header it is hidden under', async ({ page }) => {
  await page.goto(html(990)); // target top sits at y=10, under the 80px bar
  await callout(page, page.locator('#t'), 'Every span, timed', { keep: true });
  const ring = await ringRect(page);
  const box = (await page.locator('#t').boundingBox())!;
  expect(box.y).toBeGreaterThan(80); // it was scrolled out from under the bar
  expect(ring.top).toBeLessThan(box.y + box.height);
  expect(ring.bottom).toBeGreaterThan(box.y);
  expect(ring.top).toBeGreaterThan(80 - 20); // not drawn over the header
});

test('no extra scroll when the target is already unobscured', async ({ page }) => {
  await page.goto(html(900)); // target at y=100, clear of the bar
  await callout(page, page.locator('#t'), 'Every span, timed', { keep: true });
  expect(await page.evaluate(() => scrollY)).toBe(900);
});
