/**
 * Generic runner for a demo MANIFEST (JSON) — the data-only alternative to a hand-written spec.
 * record-demo.sh runs it when the input is a .json file (env DEMO_MANIFEST = its path).
 *
 * {
 *   "title": "PR #192 · …",
 *   "forbid": ["/apply/i", "Publish"],             // click/tap on matching text throws
 *   "failOn": [{ "text": "/Error code: \\d{3}/" }], // waits fail fast when this shows
 *   "localStorage": { "app:onboarding:": "done" }, // pre-seen popups (key prefix → value)
 *   "look": { "hud": { "position": "bottom" } },   // demo.configure() override
 *   "routes": [{ "url": "/api/ai/chat", "method": "POST", "json": { "job_id": "r1" } },
 *              { "url": "/api/ai/chat/status", "responses": [{ "json": {…} }, { "json": {…} }] }],
 *   "steps": [
 *     { "goto": "./" },  // relative to baseUrl; "/x" is origin-absolute (drops a subpath)
 *     { "request": { "method": "POST", "url": "/api/x", "data": {} } },
 *     { "start": true },                      { "caption": "Step 1 · …", "hold": 1500 },
 *     { "caption": "Done", "voice": { "energy": "rainbow", "say": "Done!" } },  // this line's voice (or false = silent)
 *     { "click": LOC },  { "tap": LOC },      { "type": LOC, "text": "…" },
 *     { "press": "Escape" },                  { "wait": 800 },
 *     { "waitFor": LOC, "timeout": 30000, "fastForward": 8, "state": "visible|hidden" },
 *     { "actAndWait": LOC, "caption": "…", "busy": LOC },
 *     { "zoom": LOC, "scale": 1.4, "do": [ …steps ] },
 *     { "callout": LOC, "text": "…", "hold": 2500, "keep": false, "ring": true },
 *     { "clearCallouts": true },              { "shot": "name", "target": LOC, "pad": 24, "highlight": true },
 *     { "snapshot": "after-open" },            // while authoring: ARIA tree + screenshot of this state
 *     { "hud": "" }
 *   ]
 * }
 * Defaults from project.json (forbid, failOn, localStorage, look) apply automatically; the manifest's
 * own add to them. LOC: "Button text" | { "role": "button", "name": "Send", "exact": true } | { "testId": "x" } |
 *      { "text": "…" } | { "label": "…" } | { "placeholder": "…" } | { "css": "…" }
 *      + optional "in": LOC (scope), "nth": 0, "first": true. Strings like "/re/i" are regexes.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, demo } from '../demo-recorder';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const M: Json = JSON.parse(readFileSync(process.env.DEMO_MANIFEST!, 'utf8'));
const loc = demo.loc;

async function run(page: Page, steps: Json[]): Promise<void> {
  for (const s of steps) {
    const label = JSON.stringify(s).slice(0, 120);
    try {
      if (s.goto !== undefined) await page.goto(s.goto);
      else if (s.start) await demo.startRecording(page, s.hydrate);
      else if (s.request) await page.request.fetch(s.request.url, { method: s.request.method ?? 'GET', data: s.request.data });
      else if (s.caption !== undefined) await demo.narrate(page, s.caption, s.hold ?? 1500, { voice: s.voice });
      else if (s.hud !== undefined) await demo.hud(page, s.hud, { voice: s.voice });
      else if (s.click) await demo.click(page, loc(page, s.click));
      else if (s.tap) await demo.tap(page, loc(page, s.tap));
      else if (s.type) await demo.slowType(page, loc(page, s.type), s.text ?? '', s.delay);
      else if (s.press) await page.keyboard.press(s.press);
      else if (s.wait !== undefined) await page.waitForTimeout(s.wait);
      else if (s.waitFor) {
        const target = loc(page, s.waitFor), timeout = s.timeout ?? 30_000;
        const wait = () => (s.state === 'hidden' ? expect(target).toBeHidden({ timeout }) : expect(target).toBeVisible({ timeout }));
        await demo.fastForward(page, wait, s.fastForward ?? 8);
      } else if (s.actAndWait)
        await demo.actAndWait(page, loc(page, s.actAndWait), s.caption ?? '', { ...(s.busy && { busy: loc(page, s.busy) }), ...(s.timeout && { timeoutMs: s.timeout }) });
      else if (s.zoom) await demo.withZoom(page, loc(page, s.zoom), () => run(page, s.do ?? []), { ...(s.scale && { scale: s.scale }) });
      else if (s.callout) await demo.callout(page, loc(page, s.callout), s.text ?? '', { holdMs: s.hold, keep: s.keep, ...(s.ring !== undefined && { ring: s.ring }) });
      else if (s.clearCallouts) await demo.clearCallouts(page);
      else if (s.snapshot) await demo.snapshot(page, s.snapshot); // ARIA + screenshot → $DEMO_HOME/probe/<name>.*
      else if (s.shot) await demo.shot(page, s.shot, { ...(s.target && { target: loc(page, s.target) }), pad: s.pad, highlight: s.highlight, fullPage: s.fullPage });
      else throw new Error('unknown step type');
    } catch (e) {
      if (s.optional) continue; // "optional": true → best-effort step
      throw new Error(`manifest step ${label}: ${(e as Error).message}`);
    }
  }
}

test(M.title ?? 'demo', async ({ page }) => {
  demo.resetCursor();
  if (M.look) demo.configure(M.look);
  if (M.forbid) demo.forbid(M.forbid); // adds to project.json's forbid/failOn (applied by the fixture)
  if (M.failOn) demo.failOn(...M.failOn.map((l: Json) => loc(page, l)));
  if (M.localStorage) await demo.fakeLocalStorage(page, M.localStorage);
  for (const r of M.routes ?? []) {
    let n = 0;
    await page.route(new RegExp(`${r.url}(\\?|$)`), (route) => {
      if (r.method && route.request().method() !== r.method) return route.fallback();
      const list = r.responses ?? [r];
      const res = list[Math.min(n++, list.length - 1)];
      return route.fulfill({ status: res.status ?? 200, json: res.json, body: res.body });
    });
  }
  await run(page, M.steps ?? []);
});
