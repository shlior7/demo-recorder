import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

// `share.sh` helper: upload files as GitHub *attachments* (github.com/user-attachments/…) — the only
// kind GitHub renders inline (a video URL on its own line becomes a player). There is no API for
// it, so drive the PR page's own comment box with the user's saved GitHub session: attach each file,
// read the URL GitHub writes into the textarea, then clear it. Nothing is ever submitted.
// env: GH_PR_URL, GH_UPLOAD_FILES (JSON array of paths), GH_UPLOAD_OUT (JSON {basename: url})
test('upload attachments', async ({ page }) => {
  test.setTimeout(300_000);
  const files: string[] = JSON.parse(process.env.GH_UPLOAD_FILES!);
  await page.goto(process.env.GH_PR_URL!);
  if (/\/login|\/sessions?\b|\/saml\//.test(page.url())) throw new Error(`GitHub session expired — re-run login (${page.url()})`);

  // The page has several comment boxes (PR body, hidden inline-diff ones); the new-comment box is
  // #new_comment_field and GitHub pairs each box with its own file input: #fc-<textarea id>.
  const box = page.locator('#new_comment_field').or(page.locator('textarea[name="comment[body]"]:visible').last()).first();
  await box.scrollIntoViewIfNeeded();
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.click();
  const input = page.locator(`#fc-${await box.getAttribute('id')}`);
  await expect(input).toHaveCount(1);

  const out: Record<string, string> = {};
  for (const file of files) {
    await box.fill('');
    await input.setInputFiles(file);
    // GitHub first writes an "Uploading…" placeholder, then swaps in the final URL
    await expect
      .poll(async () => /user-attachments\/(assets|files)\/[\w-]+/.test(await box.inputValue()) && !/Uploading/i.test(await box.inputValue()), {
        timeout: 240_000,
        intervals: [500, 1000, 2000],
      })
      .toBe(true);
    const url = (await box.inputValue()).match(/https:\/\/github\.com\/user-attachments\/(?:assets|files)\/[\w-]+(?:\/[^\s)"']+)?/)![0];
    out[basename(file)] = url;
    console.log(`[gh-upload] ${basename(file)} → ${url}`);
  }
  await box.fill(''); // leave no draft behind
  writeFileSync(process.env.GH_UPLOAD_OUT!, JSON.stringify(out, null, 2));
});
