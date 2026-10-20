#!/usr/bin/env bash
# Regression: two record-demo.sh takes at once on one $DEMO_HOME must both produce an mp4
# (they used to share $DEMO_HOME/test-results and the runner files, and clobber each other).
# Offline: records a tiny local page. Uses a scratch DEMO_HOME unless one is given.
#   bash skills/demo-recorder/runner/check/concurrent-runs.sh
set -euo pipefail
REC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/record-demo.sh"
SRV="" WORK="" SCRATCH=""
[[ -n "${DEMO_HOME:-}" ]] || SCRATCH="$(mktemp -d)" # ours → removed at exit (it holds a Playwright install)
trap '[[ -n "$SRV" ]] && kill "$SRV" 2>/dev/null; rm -rf "$WORK" "$SCRATCH"' EXIT
export DEMO_HOME="${DEMO_HOME:-$SCRATCH}"
WORK="$(mktemp -d)"
PORT=$((20000 + RANDOM % 20000))

cat >"$WORK/index.html" <<'EOF'
<!doctype html><body style="font:24px sans-serif;padding:40px"><h1>Concurrent take</h1>
<button onclick="this.textContent='Clicked'">Go</button></body>
EOF
for n in a b; do
  cat >"$WORK/$n.json" <<EOF
{ "baseUrl": "http://127.0.0.1:$PORT/", "steps": [
  { "goto": "./" }, { "start": true }, { "shot": "early" },
  { "caption": "Take $n", "hold": 10000 },
  { "click": { "role": "button", "name": "Go" } },
  { "caption": "Done", "hold": 2000 } ] }
EOF
done
(cd "$WORK" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!; disown
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done

bash "$REC" config >/dev/null # install once up front, so the two takes don't race npm install
bash "$REC" "$WORK/a.json" --project concurrent --no-voice >"$WORK/a.log" 2>&1 & A=$!
sleep 8 # b starts after a's early shot, mid-take — exactly when b used to rm -rf a's output
bash "$REC" "$WORK/b.json" --project concurrent --no-voice >"$WORK/b.log" 2>&1 & B=$!
FAIL=0
for n in a b; do
  if wait "$([[ $n == a ]] && echo $A || echo $B)" && grep -q '🎬 video .*\.mp4' "$WORK/$n.log" && grep -q '📸 shot:' "$WORK/$n.log"; then echo "✓ take $n → mp4 + shot"
  else echo "✗ take $n failed:"; tail -20 "$WORK/$n.log"; FAIL=1; fi
done
[[ -z "$(ls -A "$DEMO_HOME/runs")" ]] && echo "✓ run dirs cleaned up" || { echo "✗ left behind: $(ls "$DEMO_HOME/runs")"; FAIL=1; }
exit $FAIL
