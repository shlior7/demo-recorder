#!/usr/bin/env bash
# Regression: --dry-run checks a demo's logic without filming it (no video, quick, a broken locator
# fails), and --publish runs project.json `publish` with the take in env — only when asked, never on a
# failed take. Needs network (the TodoMVC example) and ffmpeg for the published take.
#   bash skills/demo-recorder/runner/check/dry-run-publish.sh
set -euo pipefail
cd "$(dirname "$0")/../../../.."
R="$PWD/skills/demo-recorder/record-demo.sh"
export DEMO_HOME="$(mktemp -d)"
trap 'rm -rf "$DEMO_HOME"' EXIT
mkdir -p "$DEMO_HOME/projects/check"
# a project whose publish step only writes down what it was handed
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ name: "check", root: process.argv[2],
  publish: "echo \"$DEMO_VIDEO|$DEMO_TITLE|$PWD\" > \"$DEMO_HOME/published\"" }))' "$DEMO_HOME/projects/check/project.json" "$DEMO_HOME"
P=(--project check)

t=$SECONDS
out="$($R examples/todomvc.json "${P[@]}" --dry-run 2>&1)"
grep -q "Dry run passed" <<<"$out" && [[ -z "$(ls "$DEMO_HOME"/videos 2>/dev/null)" ]] && echo "✓ dry run passes and films nothing ($((SECONDS - t))s)"

node -e 'const m=JSON.parse(require("fs").readFileSync("examples/todomvc.json","utf8")); m.steps.splice(3,0,{click:{testId:"no-such-control"}});
  require("fs").writeFileSync(process.argv[1], JSON.stringify(m))' "$DEMO_HOME/broken.json"
t=$SECONDS
if out="$($R "$DEMO_HOME/broken.json" "${P[@]}" --dry-run 2>&1)"; then echo "✗ a broken locator passed the dry run" >&2; exit 1; fi
grep -q "no-such-control" <<<"$out" && (( SECONDS - t < 60 )) && echo "✓ broken locator fails the dry run fast ($((SECONDS - t))s), names the step"

CHROME="${CHROME_PATH:-$(ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" /usr/bin/google-chrome 2>/dev/null | head -1 || true)}"
if [[ -n "$CHROME" ]]; then
  rm -f "$DEMO_HOME/.chromium-ok"
  DEMO_CHROMIUM="$CHROME" $R examples/todomvc.json "${P[@]}" --dry-run >/dev/null 2>&1 && [[ ! -f "$DEMO_HOME/.chromium-ok" ]] \
    && echo "✓ DEMO_CHROMIUM runs the take on an installed Chrome, no Playwright browser install"
  touch "$DEMO_HOME/.chromium-ok"
fi

if $R examples/todomvc.json "${P[@]}" --dry-run --publish >/dev/null 2>&1; then echo "✗ --dry-run --publish accepted" >&2; exit 1; fi
echo "✓ --dry-run --publish refused"

out="$($R examples/todomvc.json "${P[@]}" 2>&1)"
[[ ! -f "$DEMO_HOME/published" ]] && grep -q "add --publish only when the user asks" <<<"$out" && echo "✓ no --publish → publish not run, hint printed"

$R examples/todomvc.json "${P[@]}" --publish >/dev/null 2>&1
IFS='|' read -r video title cwd <"$DEMO_HOME/published"
[[ -f "$video" && "$video" == *.mp4 && "$title" == TodoMVC* && "$cwd" == "$DEMO_HOME" ]] && echo "✓ --publish → publish ran in the project root with DEMO_VIDEO (mp4) + DEMO_TITLE"
rm -f "$DEMO_HOME/published"

if $R "$DEMO_HOME/broken.json" "${P[@]}" --publish >/dev/null 2>&1; then echo "✗ a failed take exited 0" >&2; exit 1; fi
[[ ! -f "$DEMO_HOME/published" ]] && echo "✓ a failed take is never published"
