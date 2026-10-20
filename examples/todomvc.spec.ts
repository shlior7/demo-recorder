// The same tour as todomvc.json, as a Playwright spec — use a spec when a demo needs real logic.
import { test, expect, demo } from 'demo-recorder';

test('TodoMVC tour', async ({ page }) => {
  await page.goto('./'); // relative to baseUrl (an app under a subpath needs ./ not /)
  await demo.startRecording(page);
  await demo.narrate(page, 'TodoMVC · a 30-second tour', 2000);

  const input = page.getByPlaceholder('What needs to be done?');
  for (const todo of ['Record a demo video', 'Post it to the PR', 'Ship it']) {
    await demo.slowType(page, input, todo);
    await input.press('Enter');
  }
  await expect(page.getByTestId('todo-item')).toHaveCount(3);
  await demo.callout(page, page.getByTestId('todo-count'), 'The counter keeps up');

  const first = page.getByTestId('todo-item').first();
  await demo.withZoom(page, first, async () => {
    await demo.click(page, first.getByRole('checkbox'));
    await demo.callout(page, first, 'Done — struck through');
  }, { scale: 1.5 });
  await demo.shot(page, 'list-with-a-done-item', { target: page.locator('.todoapp'), pad: 16 });

  await demo.narrate(page, "That's the whole flow", 2000);
  await demo.hud(page, '');
});
