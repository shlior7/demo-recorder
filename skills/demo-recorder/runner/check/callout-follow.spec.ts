import { test, expect, type Page } from '@playwright/test';
import { callout } from '../demo-recorder';

// Regression: a callout stays on its target when the page reflows after it was drawn (async content
// landing above it; a terminal whose output scrolls the text through fixed row divs).
// Run from runner/ (Playwright installed, e.g. node_modules linked to ~/.demo-recorder's):
//   DEMO_TEST_DIR=$PWD/check DEMO_NO_VIDEO=1 npx playwright test --config playwright.config.ts

const ring = (page: Page) => page.evaluate(() => document.querySelector('[data-demo-ring]')!.getBoundingClientRect().toJSON());

async function expectRingOn(page: Page, target: ReturnType<Page['locator']>) {
  await expect
    .poll(async () => {
      const [r, b] = [await ring(page), (await target.boundingBox())!];
      return Math.abs(r.top + 6 - b.y) < 2 && Math.abs(r.left + 6 - b.x) < 2; // ring = target box + 6px
    })
    .toBe(true);
}

test('callout follows a target pushed down by content inserted above it', async ({ page }) => {
  await page.setContent('<body style="margin:0;font:20px sans-serif"><div id=list></div><p id=t>Target row</p></body>');
  const target = page.locator('#t');
  await callout(page, target, 'Look here', { keep: true });
  await expectRingOn(page, target);
  const before = (await ring(page)).top;
  await page.evaluate(() => document.getElementById('list')!.insertAdjacentHTML('beforeend', '<p>new</p><p>new</p>'));
  await expectRingOn(page, target);
  expect((await ring(page)).top).toBeGreaterThan(before + 40);
});

test('callout follows text that scrolls through fixed rows (terminal)', async ({ page }) => {
  await page.setContent(
    `<body style="margin:0;font:20px monospace"><div class=rows>${'<div style="height:30px"></div>'.repeat(8)}</div></body>`
  );
  const print = (lines: string[]) =>
    page.evaluate((lines) => document.querySelectorAll('.rows > div').forEach((d, i) => (d.textContent = lines[i] ?? '')), lines);
  await print(['$ ls', 'a  b', '$ git log', 'abc123 newest', '$']);
  const target = page.locator('.rows > div').filter({ hasText: /newest/ }).last();
  await callout(page, target, 'The newest commit', { keep: true });
  await expectRingOn(page, target);
  await print(['$ git log', 'abc123 newest', '$']); // output scrolled two rows up; the divs stayed put
  await expectRingOn(page, target);
  expect((await ring(page)).top).toBeLessThan(30 + 6);
});
