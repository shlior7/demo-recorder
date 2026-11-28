#!/usr/bin/env bash
# Regression: the toolkit as a package (package.json "main" → dist/) — dist/ is built from the runner's
# source, a spec in another project imports it with no DEMO_* env and gets in-page captions, the timing
# options a repo pins (hud.hold, hud.readingTime, motion.typeCapMs, motion.pace) hold, and
# `record-demo.sh finish <dir>` turns that harness's .webm + saveTimeline() files into an mp4.
# Needs network once (Playwright into a temp $DEMO_HOME) and ffmpeg.
#   bash skills/demo-recorder/runner/check/package-import.sh
set -euo pipefail
cd "$(dirname "$0")/../../../.."
REPO="$PWD" R="$PWD/skills/demo-recorder/record-demo.sh"
export DEMO_HOME="$(mktemp -d)"
P="$(mktemp -d)"
trap 'rm -rf "$DEMO_HOME" "$P"' EXIT

npx -y -p typescript@5.9.3 tsc -p tsconfig.build.json --outDir "$P/dist" >/dev/null
diff -rq "$P/dist" dist >/dev/null && echo "✓ dist/ matches the runner source" || { echo "✗ dist/ is stale — npm run build, commit dist/" >&2; exit 1; }

$R examples/todomvc.json --dry-run >/dev/null 2>&1 # installs Playwright + Chromium into $DEMO_HOME
mkdir -p "$P/node_modules" "$P/out"
ln -s "$DEMO_HOME/node_modules/@playwright" "$P/node_modules/@playwright"
ln -s "$DEMO_HOME/node_modules/playwright" "$P/node_modules/playwright"
ln -s "$DEMO_HOME/node_modules/playwright-core" "$P/node_modules/playwright-core"
mkdir "$P/node_modules/demo-recorder" && cp -R "$REPO/package.json" "$REPO/dist" "$P/node_modules/demo-recorder/" # what an install ships ("files")
node -e 'require("fs").writeFileSync(process.argv[1], `module.exports = { testDir: ".", reporter: "line", use: { viewport: { width: 1280, height: 720 }, video: { mode: "on", size: { width: 1280, height: 720 } } } };`)' "$P/playwright.config.js"
node -e 'require("fs").writeFileSync(process.argv[1], `
import { test, expect } from "@playwright/test";
import { demo } from "demo-recorder";
test("imported outside the runner", async ({ page }) => {
  demo.begin();
  demo.resetCursor();
  await page.setContent("<input id=f style=\\"margin:200px\\">");
  await demo.startRecording(page, 100);
  let t = Date.now();
  await demo.narrate(page, "Captions on the page");
  await expect(page.locator("#demo-hud")).toHaveText("Captions on the page");
  console.log("CHECK hold", Date.now() - t);
  demo.configure({ hud: { hold: 1500, readingTime: false }, motion: { typeCapMs: 0 } });
  t = Date.now();
  await demo.narrate(page, "Pinned hold");
  await demo.narrate(page, "No reading wait", 0);
  console.log("CHECK pinned", Date.now() - t);
  t = Date.now();
  await demo.slowType(page, page.locator("#f"), "x".repeat(60), 95);
  console.log("CHECK nocap", Date.now() - t);
  demo.configure({ motion: { pace: 0 } });
  t = Date.now();
  await demo.slowType(page, page.locator("#f"), "y".repeat(60), 95);
  await demo.narrate(page, "Instant");
  console.log("CHECK pace0", Date.now() - t);
  await expect(page.locator("#f")).toHaveValue("y".repeat(60));
  demo.configure({ motion: { pace: 1 } });
  await demo.narrate(page, "The end", 800);
  demo.saveTimeline(process.env.OUT);
  await page.close();
  await page.video().saveAs(process.env.OUT + "/take.webm");
});`)' "$P/import.spec.ts"

out="$(cd "$P" && OUT="$P/out" node node_modules/@playwright/test/cli.js test 2>&1)" || { echo "$out" >&2; echo "✗ spec importing the package failed" >&2; exit 1; }
ms() { sed -n "s/.*CHECK $1 \([0-9]*\).*/\1/p" <<<"$out"; }
echo "✓ imported with no DEMO_* env; caption drawn on the page (#demo-hud)"
(( $(ms hold) >= 1150 )) && echo "✓ narrate default hold 1200 ms ($(ms hold) ms)"
(( $(ms pinned) >= 1450 && $(ms pinned) < 2600 )) && echo "✓ hud.hold 1500 + readingTime false: next caption doesn't wait to be read ($(ms pinned) ms)"
(( $(ms nocap) >= 5500 )) && echo "✓ motion.typeCapMs 0: 60 chars at 95 ms, no 3.5 s cap ($(ms nocap) ms)"
(( $(ms pace0) < 1500 )) && echo "✓ motion.pace 0: typing + hold instant ($(ms pace0) ms)"
grep -q '"text":"Pinned hold"' "$P/out/captions.json" && [[ -f "$P/out/segments.json" && -f "$P/out/steps.json" ]] && echo "✓ saveTimeline(dir) wrote captions/segments/steps.json"

$R finish "$P/out" >/dev/null 2>&1
[[ -f "$P/out/take.mp4" && -f "$P/out/take-sheet.png" ]] && echo "✓ record-demo.sh finish <dir> → take.mp4 + sheet"
