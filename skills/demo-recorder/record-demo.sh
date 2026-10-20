#!/usr/bin/env bash
#
# record-demo.sh — record a narrated demo video of any running web app from a Playwright spec or a
# JSON manifest. The target repo needs nothing installed: Playwright lives in $DEMO_HOME
# (default ~/.demo-recorder). Per-project values (URL, start commands, auth, safety rules) live in
# project.json — see `init`.
#
#   record-demo.sh <demo.json|demo.spec.ts> [--project p] [--url u] [--auth name] [--speed 1.3] [--headed] [--open]
#   record-demo.sh init [--project p] [--team]     # scaffold project.json (detects dev script + port)
#   record-demo.sh project [--project p]           # show the resolved project settings
#   record-demo.sh up [--project p] [--root dir]   # start project.start[] in the background, wait until ready
#   record-demo.sh down [--project p]              # stop what `up` started
#   record-demo.sh servers                         # listening dev servers → port, cwd, git branch
#   record-demo.sh probe [--url page-url] [--auth …]   # ARIA snapshot + screenshot, to pick locators
#   record-demo.sh login <url> <name> [--browser brave|chrome]  # log in by hand; saves auth/<name>.json
#   record-demo.sh login <name> --from brave|chrome [--domain d] # reuse your browser's login (macOS)
#   record-demo.sh config [key [value]]            # global settings (hud.*, callout.*, share.*)
#   record-demo.sh share <video.mp4> --repo <worktree> [--pr N] [--video attach|page|link]
#
# Output: $DEMO_HOME/videos/<project>/<demo>-<ts>.mp4 + -shots/ (stills) + -steps/ (a frame per
#         caption, to verify) + -sheet.png (3x3 contact sheet) + .webm (raw)

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_HOME="${DEMO_HOME:-$HOME/.demo-recorder}"
RUNNER_FILES=(demo-recorder.ts playwright.config.ts tsconfig.json timeline.mjs config.mjs config.defaults.json login.mjs project.mjs)

sync_runner() {
  mkdir -p "$DEMO_HOME"/{projects,auth,videos,probe,manifest}
  for f in "${RUNNER_FILES[@]}"; do cp "$SKILL_DIR/runner/$f" "$DEMO_HOME/"; done
  cp "$SKILL_DIR/runner/probe.spec.ts" "$DEMO_HOME/probe/"
  cp "$SKILL_DIR/runner/manifest.spec.ts" "$DEMO_HOME/manifest/"
  if ! cmp -s "$SKILL_DIR/runner/package.json" "$DEMO_HOME/package.json" || [[ ! -d "$DEMO_HOME/node_modules/@playwright/test" ]]; then
    cp "$SKILL_DIR/runner/package.json" "$DEMO_HOME/"
    echo "▶ Installing Playwright into $DEMO_HOME …" >&2
    (cd "$DEMO_HOME" && npm install --silent --no-audit --no-fund)
  fi
  (cd "$DEMO_HOME" && npx playwright install chromium >/dev/null)
}
open_file() { if command -v open >/dev/null; then open "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1; fi; }
url_of() { node -e 'console.log(require("url").pathToFileURL(process.argv[1]).href)' "$1"; }

# --- project resolution (sets PROJECT_JSON, PNAME, PROOT, PFILE) ---
PROJECT_ARG="-"
resolve_project() { # $1 = spec path or -
  PROJECT_JSON="$(node "$SKILL_DIR/runner/project.mjs" resolve "$DEMO_HOME" "$PROJECT_ARG" "${1:--}" "$PWD")"
  pget() { node -e 'const p=JSON.parse(process.argv[1]); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],p); console.log(v==null?"":typeof v==="object"?JSON.stringify(v):v)' "$PROJECT_JSON" "$1"; }
  PNAME="$(pget name)"; PROOT="$(pget root)"; PFILE="$(pget file)"
}

CMD="${1:-}"
# pull --project out of the args wherever it is
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in --project) PROJECT_ARG="$2"; shift 2 ;; *) ARGS+=("$1"); shift ;; esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

case "$CMD" in
  ""|-h|--help)
    sed -n 3,22p "$0"; exit 0 ;;

  init)
    shift; sync_runner >/dev/null
    node "$SKILL_DIR/runner/project.mjs" init "$DEMO_HOME" "$PROJECT_ARG" "$PWD" "${1:-}"
    resolve_project -; echo "→ edit $PFILE (baseUrl, start[], auth, forbid, failOn), then: record-demo.sh up"
    exit 0 ;;

  project)
    resolve_project -
    [[ -n "$PFILE" ]] || { echo "No project.json for '$PNAME' — run: record-demo.sh init" >&2; exit 1; }
    node -e 'const p=JSON.parse(process.argv[1]); console.log("file: "+p.file+"\nroot: "+p.root); console.log(JSON.stringify(p.config,null,2))' "$PROJECT_JSON"
    exit 0 ;;

  up|down)
    shift; ROOT_OVERRIDE=""
    [[ "${1:-}" == --root ]] && { ROOT_OVERRIDE="$(cd "$2" && pwd)"; shift 2; }
    resolve_project -
    [[ -n "$PFILE" ]] || { echo "No project.json — run: record-demo.sh init" >&2; exit 1; }
    RUN="$DEMO_HOME/projects/$PNAME/run"; mkdir -p "$RUN"
    ROOT="${ROOT_OVERRIDE:-$PROOT}"
    COUNT="$(node -e 'console.log((JSON.parse(process.argv[1]).config.start||[]).length)' "$PROJECT_JSON")"
    for ((i = 0; i < COUNT; i++)); do
      S="$(node -e 'const s=JSON.parse(process.argv[1]).config.start[+process.argv[2]]; console.log([s.name||"svc"+process.argv[2], s.cwd||".", s.command, s.ready||"", JSON.stringify(s.env||{})].join("\u001f"))' "$PROJECT_JSON" "$i")"
      IFS=$'\x1f' read -r NAME CWD COMMAND READY ENVJSON <<<"$S"
      PIDF="$RUN/$NAME.pid"
      if [[ $CMD == down ]]; then
        # each service runs in its own process group → kill the whole tree (dev servers spawn children)
        if [[ -f "$PIDF" ]]; then P="$(cat "$PIDF")"; kill -TERM -- "-$P" 2>/dev/null || kill -TERM "$P" 2>/dev/null || true; rm -f "$PIDF"; echo "■ stopped $NAME"; fi
        continue
      fi
      if [[ -n "$READY" ]] && curl -sk -o /dev/null --max-time 3 "$READY"; then echo "✓ $NAME already up at $READY"; continue; fi
      ENV_ARGS=(); while IFS= read -r kv; do [[ -n "$kv" ]] && ENV_ARGS+=("$kv"); done < <(node -e 'for (const [k,v] of Object.entries(JSON.parse(process.argv[1]))) console.log(k+"="+v)' "$ENVJSON")
      # set -m → own process group; exec → the pid IS the service, and nothing keeps our stdout open
      set -m
      (cd "$ROOT/$CWD" && exec nohup env ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} bash -c "$COMMAND" >"$RUN/$NAME.log" 2>&1 </dev/null) &
      echo $! >"$PIDF"
      set +m
      echo "▶ $NAME: $COMMAND  (in $ROOT/$CWD, log $RUN/$NAME.log)"
      if [[ -n "$READY" ]]; then
        for _ in $(seq 1 180); do curl -sk -o /dev/null --max-time 2 "$READY" && break; sleep 1; done
        curl -sk -o /dev/null --max-time 2 "$READY" && echo "✓ $NAME ready at $READY" || { echo "✗ $NAME not ready after 180s — see $RUN/$NAME.log" >&2; exit 1; }
      fi
    done
    exit 0 ;;

  servers)
    # Which branch is each running dev server actually serving? (cwd of the listening process)
    lsof -nP -iTCP -sTCP:LISTEN -Fpcn 2>/dev/null | awk '
      /^p/ {pid=substr($0,2)} /^c/ {cmd=substr($0,2)}
      /^n/ {n=$0; sub(/.*:/,"",n); if (!seen[pid":"n]++) print pid, cmd, n}' |
    while read -r pid cmd port; do
      case "$cmd" in node|python*|Python|java|ruby|bun|deno|php|go|dotnet) ;; *) continue ;; esac
      cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
      br="$(git -C "$cwd" branch --show-current 2>/dev/null || true)"
      [[ -n "$br" ]] || br="$(git -C "$cwd" log -1 --format='detached@%h %D' 2>/dev/null | sed 's/HEAD, //; s/HEAD$//' || true)"
      printf ':%-6s %-8s %-8s %s  [%s]\n' "$port" "$pid" "$cmd" "$cwd" "${br:--}"
    done | sort -t: -k2 -n
    exit 0 ;;

  config)
    shift; sync_runner >/dev/null
    node "$DEMO_HOME/config.mjs" "$DEMO_HOME/config.defaults.json" "$DEMO_HOME/config.json" "$@"
    exit 0 ;;

  share)
    shift; exec bash "$SKILL_DIR/share.sh" "$@" ;;

  login)
    shift; LARGS=() FROM="" BROWSER="" DOMAIN=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --from) FROM="$2"; shift 2 ;;
        --browser) BROWSER="$2"; shift 2 ;;
        --domain) DOMAIN="$2"; shift 2 ;;
        *) LARGS+=("$1"); shift ;;
      esac
    done
    sync_runner
    mkdir -p "$DEMO_HOME/auth"; chmod 700 "$DEMO_HOME/auth"
    if [[ -n "$FROM" ]]; then
      NAME="${LARGS[0]:?usage: record-demo.sh login <name> --from brave|chrome [--domain host]}"
      [[ -n "$DOMAIN" ]] || { [[ "$NAME" == github ]] && DOMAIN=github.com; }
      [[ -n "$DOMAIN" ]] || { echo "✗ --domain <host> required (whose cookies to keep)" >&2; exit 1; }
      echo "▶ Importing your $DOMAIN login from $FROM (macOS asks once to allow Keychain access — Allow)…"
      (cd "$DEMO_HOME" && node login.mjs import "$FROM" "auth/$NAME.json" "$DOMAIN")
    else
      URL="${LARGS[0]:?usage: record-demo.sh login <url> <name> [--browser brave|chrome]}"; NAME="${LARGS[1]:?usage: record-demo.sh login <url> <name>}"
      echo "▶ Log in in the opened ${BROWSER:-Chromium} window, then CLOSE it to save the session."
      (cd "$DEMO_HOME" && node login.mjs open "$URL" "auth/$NAME.json" "${BROWSER:-chromium}" "$DEMO_HOME/profiles/$NAME")
    fi
    chmod 600 "$DEMO_HOME/auth/$NAME.json"   # it IS your logged-in session
    echo "✓ Saved $DEMO_HOME/auth/$NAME.json — use --auth $NAME (or \"auth\": \"$NAME\" in project.json)"
    exit 0 ;;
esac

# ---------------------------------------------------------------- record / probe
PROBE=0
if [[ "$1" == probe ]]; then PROBE=1; SPEC="$DEMO_HOME/probe/probe.spec.ts"
else SPEC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; fi
shift
URL="" AUTH="" SPEED=1 HEADED=() OPEN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --auth) AUTH="$2"; shift 2 ;;
    --speed) SPEED="$2"; shift 2 ;;
    --headed) HEADED=(--headed); shift ;;
    --open) OPEN=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done
[[ $PROBE == 1 ]] || [[ -f "$SPEC" ]] || { echo "✗ Not found: $SPEC" >&2; exit 1; }
resolve_project "$([[ $PROBE == 1 ]] && echo - || echo "$SPEC")"

# precedence: flag > manifest > project.json
mget() { [[ "$SPEC" == *.json ]] && node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];console.log(v??"")}catch{}' "$SPEC" "$1" || true; }
[[ -n "$URL" ]] || URL="$(mget baseUrl)"
[[ -n "$URL" ]] || URL="$(pget config.baseUrl)"
[[ -n "$URL" ]] || { echo "✗ No URL — pass --url, or set baseUrl in project.json (record-demo.sh init)" >&2; exit 1; }
[[ -n "$AUTH" ]] || AUTH="$(mget auth)"
[[ -n "$AUTH" ]] || AUTH="$(pget config.auth)"
if [[ -n "$AUTH" ]]; then
  [[ -f "$AUTH" ]] || AUTH="$DEMO_HOME/auth/$AUTH.json"
  [[ -f "$AUTH" ]] || { echo "✗ No saved login: $AUTH — run: record-demo.sh login <url> <name>  (or login <name> --from brave)" >&2; exit 1; }
fi
VIEWPORT="${DEMO_VIEWPORT:-$(pget config.viewport)}"
COLOR="${DEMO_COLOR_SCHEME:-$(pget config.colorScheme)}"

curl -sk -o /dev/null --max-time 10 "$URL" || { echo "✗ $URL is not reachable — start the app (record-demo.sh up) first." >&2; exit 1; }

sync_runner

RUN_SPEC="$SPEC" MANIFEST=""
if [[ "$SPEC" == *.json ]]; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$SPEC" || { echo "✗ $SPEC is not valid JSON" >&2; exit 1; }
  MANIFEST="$SPEC"; RUN_SPEC="$DEMO_HOME/manifest/manifest.spec.ts"
fi

OUT_RAW="$DEMO_HOME/test-results"
SEGMENTS="$OUT_RAW/segments.json"
STEPS="$OUT_RAW/steps.json"
rm -rf "$OUT_RAW"

[[ $PROBE == 1 ]] || echo "▶ Recording $SPEC against $URL (project: $PNAME) …"
set +e
(cd "$DEMO_HOME" && \
  DEMO_PROBE_SHOT="$DEMO_HOME/probe/probe.png" DEMO_PROBE_DIR="$DEMO_HOME/probe" \
  DEMO_SEGMENTS_FILE="$SEGMENTS" DEMO_STEPS_FILE="$STEPS" DEMO_SHOTS_DIR="$OUT_RAW/shots" \
  DEMO_CONFIG="$(node "$DEMO_HOME/config.mjs" "$DEMO_HOME/config.defaults.json" "$DEMO_HOME/config.json")" \
  DEMO_PROJECT="$(pget config)" DEMO_MANIFEST="$MANIFEST" \
  DEMO_TEST_DIR="$(dirname "$RUN_SPEC")" DEMO_OUTPUT_DIR="$OUT_RAW" DEMO_TSCONFIG="$DEMO_HOME/tsconfig.json" \
  DEMO_SPEED="$SPEED" DEMO_BASE_URL="$URL" DEMO_STORAGE_STATE="$AUTH" DEMO_VIEWPORT="${VIEWPORT:-1680x1050}" DEMO_COLOR_SCHEME="${COLOR:-light}" \
  npx playwright test "$(basename "$RUN_SPEC")" --config playwright.config.ts ${HEADED[@]+"${HEADED[@]}"})
STATUS=$?
set -e
if [[ $PROBE == 1 ]]; then echo "✓ Screenshot: $DEMO_HOME/probe/probe.png"; exit $STATUS; fi

# The video is written on context close even when asserts fail — keep going and report the status.
WEBM="$(find "$OUT_RAW" -name '*.webm' -type f 2>/dev/null | head -1)"
[[ -n "$WEBM" ]] || { echo "✗ No video recorded — check the run output above." >&2; exit 1; }

DEST_DIR="$DEMO_HOME/videos/$PNAME"
STEM="$DEST_DIR/$(basename "$SPEC" | sed -E 's/\.(ts|json)$//; s/\.spec$//')-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST_DIR"
cp "$WEBM" "$STEM.webm"

if command -v ffmpeg >/dev/null; then
  # mp4/h264 plays everywhere (Slack, Jira, GitHub, QuickTime); even dims required by yuv420p.
  RAW_DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WEBM")"
  # Waits marked by demo.fastForward/actAndWait play faster, cuts (shots, lead-in) vanish; rest at --speed.
  FF="$(node "$DEMO_HOME/timeline.mjs" "$SEGMENTS" "$RAW_DUR" "$SPEED")"
  EVEN="scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30"
  if [[ -n "$FF" ]]; then FILTER=(-filter_complex "$FF;[vc]$EVEN[out]" -map "[out]")
  else FILTER=(-vf "setpts=PTS/$SPEED,$EVEN"); fi
  ffmpeg -loglevel error -y -i "$WEBM" -an "${FILTER[@]}" \
    -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "$STEM.mp4"
  DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$STEM.mp4")"
  ffmpeg -loglevel error -y -i "$STEM.mp4" -vf "fps=9/$DUR,scale=560:-1,tile=3x3" -frames:v 1 "$STEM-sheet.png" || true
  # One frame at the end of each caption step (from the raw video) — to verify beat by beat.
  node "$DEMO_HOME/timeline.mjs" steps "$STEPS" "$RAW_DUR" | while IFS=$'\t' read -r at name; do
    mkdir -p "$STEM-steps"
    ffmpeg -loglevel error -y -ss "$at" -i "$WEBM" -frames:v 1 "$STEM-steps/$name.png" </dev/null || true
  done
fi
[[ -d "$OUT_RAW/shots" ]] && cp -R "$OUT_RAW/shots" "$STEM-shots"

# file:// URLs — plain paths and markdown links aren't clickable in every terminal.
echo ""
echo "━━ RESULT ━━"
if [[ -f "$STEM.mp4" ]]; then
  echo "🎬 video  ${DUR%.*}s from ${RAW_DUR%.*}s raw, ×$SPEED${FF:+, waits fast-forwarded}: $(url_of "$STEM.mp4")"
  echo "🖼  sheet: $(url_of "$STEM-sheet.png")"
else
  echo "🎬 video (webm — install ffmpeg for mp4): $(url_of "$STEM.webm")"
fi
[[ -d "$STEM-shots" ]] && for f in "$STEM-shots"/*.png; do echo "📸 shot:  $(url_of "$f")"; done
[[ -d "$STEM-steps" ]] && echo "🔎 steps: $(url_of "$STEM-steps") ($(ls "$STEM-steps" | wc -l | tr -d ' ') frames)"
[[ $OPEN == 1 ]] && { open_file "$STEM.mp4" || open_file "$STEM.webm"; }

[[ $STATUS -eq 0 ]] || echo "⚠ Spec exited $STATUS — the video may stop early. Check the log above."
exit $STATUS
