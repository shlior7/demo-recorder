// Recording a terminal (any CLI or TUI, Claude Code included): ttyd serves the shell in the browser.
// DOM renderer, or the text is pixels on a canvas that getByText/callouts can't see; a plain prompt
// so "the command finished" is just "an empty `$ ` row is back". Run it in any git checkout:
//   ttyd -p 7681 -W -t rendererType=dom -t fontSize=19 -t disableLeaveAlert=true env PS1='$ ' PAGER=cat BASH_SILENCE_DEPRECATION_WARNING=1 bash --norc
//   record-demo.sh examples/terminal.spec.ts --url http://127.0.0.1:7681
import { test, expect, demo } from 'demo-recorder';
import type { Page } from '@playwright/test';

/** The last terminal row whose text matches (rows are `.xterm-rows > div`). */
const row = (page: Page, re: RegExp) => page.locator('.xterm-rows > div').filter({ hasText: re }).last();

/** Type at the shell's cursor like a person, Enter, wait for the next prompt. Not slowType: it
 *  selects-all first — right for an input, wrong for a shell. */
async function run(page: Page, cmd: string) {
  await demo.moveTo(page, page.locator('.xterm-cursor').first());
  await page.keyboard.type(cmd, { delay: 70 });
  await page.keyboard.press('Enter');
  await expect(row(page, /^\$\s*$/)).toBeVisible();
}

test('A terminal tour', async ({ page }) => {
  // One page for the whole take: ttyd starts a fresh shell per connection, and navigating away
  // closes the socket — killing the shell and anything running in it. Show other things in an overlay.
  await page.goto('/');
  await page.locator('.xterm').click();
  await page.keyboard.type('clear\n');
  await demo.startRecording(page);
  await demo.narrate(page, 'Record any terminal, right in the browser', 1500);

  await demo.narrate(page, 'Look around the repo', 400);
  await run(page, 'ls');

  await demo.narrate(page, 'Check the latest commits', 400);
  await run(page, 'git log --oneline -3');
  await demo.callout(page, page.locator('.xterm-rows > div').filter({ hasText: /^[0-9a-f]{7,} / }).first(), 'Newest first');

  await demo.narrate(page, "That's a terminal demo", 2000);
  await demo.hud(page, '');
});
