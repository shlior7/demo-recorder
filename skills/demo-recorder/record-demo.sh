#!/usr/bin/env bash
#
# record-demo.sh — record a narrated demo video of any running web app from a Playwright spec or a
# JSON manifest. The target repo needs nothing installed: Playwright lives in $DEMO_HOME
# (default ~/.demo-recorder). Per-project values (URL, start commands, auth, safety rules) live in
# project.json — see `init`.
#
#   record-demo.sh <demo.json|demo.spec.ts> [--project p] [--url u] [--auth name] [--speed 1.3] [--voice|--no-voice] [--headed] [--open]
#   record-demo.sh brief [--pr N] [--project p]    # everything to plan a take: project, NOTES, servers, demos, PR
#   record-demo.sh init [--project p] [--team]     # scaffold project.json (detects dev script + port)
#   record-demo.sh project [--project p]           # show the resolved project settings
#   record-demo.sh worktree <ref> [--as name]      # cached checkout of <ref> under $DEMO_HOME/worktrees → prints its path
#   record-demo.sh up [--project p] [--root dir]   # start project.start[] in the background, wait until ready
#   record-demo.sh down [--project p]              # stop what `up` started
#   record-demo.sh servers                         # listening dev servers → port, cwd, git branch
#   record-demo.sh probe [--url page-url] [--auth …]   # ARIA snapshot + screenshot, to pick locators
#   record-demo.sh login <url> <name> [--browser brave|chrome]  # log in by hand; saves auth/<name>.json
#   record-demo.sh login <name> --from brave|chrome [--domain d] # reuse your browser's login (macOS)
#   record-demo.sh config [key [value]]            # global settings (hud.*, callout.*, voice.*, share.*)
#   record-demo.sh voice ["Some caption"]          # install Chatterbox (once) and read a line with voice.* settings
#   record-demo.sh setup ffmpeg                    # download a static ffmpeg + ffprobe into $DEMO_HOME (~60 MB) — ask first
#   record-demo.sh revoice <take.mp4> [--line T] [--energy E] [--say S] [--tries N]  # re-read captions, video untouched
#   record-demo.sh share <video.mp4> --repo <worktree> [--pr N] [--video attach|page|link]
#
# Output: $DEMO_HOME/videos/<project>/<demo>-<ts>.mp4 + -shots/ (stills) + -steps/ (a frame per
#         caption, to verify) + -sheet.png (3x3 contact sheet) + .webm (raw: no caption bar, no voice)
#         + -chapters.json (every caption/callout/fast-forward/still in final-video seconds)

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_HOME="${DEMO_HOME:-$HOME/.demo-recorder}"
RUNNER_FILES=(demo-recorder.ts playwright.config.ts tsconfig.json timeline.mjs voice.py)
VOICE_PY="$DEMO_HOME/voice/venv/bin/python"

# Shared install only (node_modules, Chromium). A take never runs files from $DEMO_HOME itself: it
# snapshots the runner into its own $DEMO_HOME/runs/<id>/ (see below), so a concurrent run of another
# plugin version can't swap them mid-take. login.mjs is the one file kept here (it needs node_modules).
sync_runner() {
  mkdir -p "$DEMO_HOME"/{projects,auth,videos,probe,runs}
  cp "$SKILL_DIR/runner/login.mjs" "$DEMO_HOME/"
  if ! cmp -s "$SKILL_DIR/runner/package.json" "$DEMO_HOME/package.json" || [[ ! -d "$DEMO_HOME/node_modules/@playwright/test" ]]; then
    cp "$SKILL_DIR/runner/package.json" "$DEMO_HOME/"
    echo "▶ Installing Playwright into $DEMO_HOME …" >&2
    (cd "$DEMO_HOME" && npm install --silent --no-audit --no-fund)
    rm -f "$DEMO_HOME/.chromium-ok"
  fi
  # ~0.5 s even when nothing's missing → only after a (re)install
  [[ -f "$DEMO_HOME/.chromium-ok" ]] || { (cd "$DEMO_HOME" && npx playwright install chromium >/dev/null) && touch "$DEMO_HOME/.chromium-ok"; }
}
# Chatterbox TTS in its own venv under $DEMO_HOME (torch + ~3 GB of weights, fetched on first use).
ensure_voice() {
  "$VOICE_PY" -c 'import chatterbox' 2>/dev/null && return
  local py; py="$(command -v python3.11 || command -v python3.12 || command -v python3)"
  echo "▶ Installing Chatterbox TTS into $DEMO_HOME/voice (one time) …" >&2
  "$py" -m venv "$DEMO_HOME/voice/venv"
  "$VOICE_PY" -m pip install -q --upgrade pip
  # a private mirror may lack some wheels → fall back to public PyPI
  "$VOICE_PY" -m pip install -q chatterbox-tts || "$VOICE_PY" -m pip install -q --index-url https://pypi.org/simple chatterbox-tts
}
# ffmpeg + ffprobe for post-production: $DEMO_FFMPEG (a path, or "none") > on PATH > the static build that
# `record-demo.sh setup ffmpeg` downloads into $DEMO_HOME/ffmpeg. Nothing is ever downloaded unasked.
FF_DIR="$DEMO_HOME/ffmpeg"
FF_HINT="record-demo.sh setup ffmpeg (static build, ~60 MB, one time) — or brew install ffmpeg / apt install ffmpeg"
resolve_ffmpeg() {
  FFMPEG="" FFPROBE=""
  if [[ "${DEMO_FFMPEG:-}" == none ]]; then :
  elif [[ -n "${DEMO_FFMPEG:-}" ]]; then FFMPEG="$DEMO_FFMPEG"; FFPROBE="${DEMO_FFPROBE:-$(dirname "$DEMO_FFMPEG")/ffprobe}"
  elif command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null; then FFMPEG="$(command -v ffmpeg)"; FFPROBE="$(command -v ffprobe)"
  elif [[ -x "$FF_DIR/bin/ffmpeg" && -x "$FF_DIR/bin/ffprobe" ]]; then FFMPEG="$FF_DIR/bin/ffmpeg"; FFPROBE="$FF_DIR/bin/ffprobe"
  fi
  export FFMPEG FFPROBE
}
need_ffmpeg() { [[ -n "$FFMPEG" ]] || { echo "✗ needs ffmpeg + ffprobe — $FF_HINT" >&2; exit 1; }; }
resolve_ffmpeg
config_json() { node "$SKILL_DIR/runner/config.mjs" "$SKILL_DIR/runner/config.defaults.json" "$DEMO_HOME/config.json" "$@"; }
open_file() { if command -v open >/dev/null; then open "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1" >/dev/null 2>&1; fi; }
url_of() { node -e 'console.log(require("url").pathToFileURL(process.argv[1]).href)' "$1"; }

# --- project resolution (sets PROJECT_JSON, PNAME, PROOT, PFILE) ---
PROJECT_ARG="-"
resolve_project() { # $1 = spec path or -
  PROJECT_JSON="$(node "$SKILL_DIR/runner/project.mjs" resolve "$DEMO_HOME" "$PROJECT_ARG" "${1:--}" "$PWD")"
  pget() { node -e 'const p=JSON.parse(process.argv[1]); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],p); console.log(v==null?"":typeof v==="object"?JSON.stringify(v):v)' "$PROJECT_JSON" "$1"; }
  PNAME="$(pget name)"; PROOT="$(pget root)"; PFILE="$(pget file)"
}
# the repo to ask git/gh about: the cwd's checkout, else the project's root
repo_dir() { git rev-parse --show-toplevel 2>/dev/null || echo "$PROOT"; }

# Which branch is each running dev server actually serving? (cwd of the listening process)
list_servers() {
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
    sed -n 3,27p "$0"; exit 0 ;;

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
    list_servers; exit 0 ;;

  brief)
    # One call instead of a dozen: what an agent needs before planning a take.
    shift; PR=""
    [[ "${1:-}" == --pr ]] && { PR="$2"; shift 2; }
    resolve_project -
    REPO="$(repo_dir)"; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
    if [[ -n "$PR" ]]; then # network calls first, in the background, while the local sections print
      DEF="$(git -C "$REPO" symbolic-ref -q --short refs/remotes/origin/HEAD || { git -C "$REPO" rev-parse -q --verify origin/main >/dev/null && echo origin/main; } || echo origin/master)"
      (cd "$REPO" && gh pr view "$PR" --json number,title,state,url,headRefName,baseRefName,headRefOid,mergeCommit,body,files \
        --jq '"#\(.number) \(.title)  [\(.state)]  \(.url)\nhead \(.headRefName) @ \(.headRefOid[:9])  base \(.baseRefName)  merge \(.mergeCommit.oid // "-" | .[:9])\nmerge\t\(.mergeCommit.oid // "")\nfiles:\n\(.files | map("  +\(.additions) -\(.deletions)  \(.path)") | join("\n"))\nbody:\n\(.body)"' >"$TMP/pr" 2>&1) &
      (GIT_TERMINAL_PROMPT=0 git -C "$REPO" fetch -q origin "${DEF#origin/}" 2>/dev/null) &
    fi
    echo "── tools"
    if [[ -n "$FFMPEG" ]]; then echo "  ffmpeg  $FFMPEG"
    else echo "  ffmpeg  MISSING — a take would be a raw .webm (no caption bar, fast-forward, voice, mp4). Ask the user, then: $FF_HINT"; fi
    if compgen -G "$DEMO_HOME/voice/venv/lib/python*/site-packages/chatterbox" >/dev/null; then echo "  voice   installed ($DEMO_HOME/voice)"
    else echo "  voice   not installed — the first --voice take installs Chatterbox (~3 GB, minutes). Ask the user first."; fi
    echo "── project $PNAME  (${PFILE:-no project.json — run: record-demo.sh init})  root $PROOT"
    [[ -n "$PFILE" ]] && node -e 'console.log(JSON.stringify(JSON.parse(process.argv[1]).config,null,2))' "$PROJECT_JSON"
    NOTES="$DEMO_HOME/projects/$PNAME/NOTES.md"
    echo "── NOTES.md  ($NOTES)"; cat "$NOTES" 2>/dev/null || echo "(none yet)"
    echo "── servers  :port pid cmd cwd [branch]"; list_servers
    echo "── cached worktrees  ($DEMO_HOME/worktrees/$PNAME)"
    for w in "$DEMO_HOME/worktrees/$PNAME"/*/; do [[ -d "$w" ]] && echo "  $(git -C "$w" log -1 --format='%h %cd' --date=short 2>/dev/null)  ${w%/}"; done
    echo "── demos · newest take"
    node -e '
      const fs = require("fs"), [demos, videos] = process.argv.slice(1);
      const ls = (d) => { try { return fs.readdirSync(d).sort(); } catch { return []; } };
      const takes = {};
      for (const f of ls(videos)) {
        const m = f.match(/^(.*)-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)\d\d\.mp4$/);
        if (m) takes[m[1]] = { n: (takes[m[1]]?.n ?? 0) + 1, at: `${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}`, file: `${videos}/${f}` };
      }
      const files = Object.fromEntries(ls(demos).filter((f) => /\.(json|ts)$/.test(f)).map((f) => [f.replace(/(\.spec)?\.(ts|json)$/, ""), f]));
      const stems = [...new Set([...Object.keys(files), ...Object.keys(takes)])];
      if (!stems.length) console.log("(none yet)");
      for (const s of stems) {
        const t = takes[s];
        console.log(`  ${(files[s] ?? s + " (no demo file)").padEnd(36)} ${t ? `${t.n} take(s), newest ${t.at}  ${t.file}` : "no takes"}`);
      }' "$DEMO_HOME/projects/$PNAME/demos" "$DEMO_HOME/videos/$PNAME"
    if [[ -n "$PR" ]]; then
      wait
      MERGE="$(awk -F'\t' '$1 == "merge" { print $2 }' "$TMP/pr")"
      echo "── PR $PR"; grep -v $'^merge\t' "$TMP/pr" || true
      if [[ -n "$MERGE" ]]; then
        git -C "$REPO" merge-base --is-ancestor "$MERGE" "$DEF" 2>/dev/null && echo "── merge commit ${MERGE:0:9} IS in $DEF" || echo "── merge commit ${MERGE:0:9} is NOT in $DEF"
      fi
    fi
    exit 0 ;;

  worktree)
    # A checkout of <ref> kept under $DEMO_HOME/worktrees/<project>/<name> and reused by later takes and
    # sessions: fetch + checkout + `setup` (project.json, e.g. "yarn install") only when HEAD moved.
    # Only ever touches that directory — the user's own checkouts stay as they are.
    shift; REF="${1:?usage: record-demo.sh worktree <branch|sha|pull/N/head> [--as name]}"; NAME="$REF"
    [[ "${2:-}" == --as ]] && NAME="${3:?--as needs a name}"
    resolve_project -
    REPO="$(repo_dir)"; NAME="$(printf %s "$NAME" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^\.*//')"; [[ -n "$NAME" ]] || { echo "✗ bad worktree name" >&2; exit 1; }
    WT="$DEMO_HOME/worktrees/$PNAME/$NAME"
    # -f: re-register a path whose dir was deleted by hand; --no-checkout: the checkout below does it once
    [[ -e "$WT/.git" ]] || { mkdir -p "$(dirname "$WT")" && git -C "$REPO" worktree add -q -f --detach --no-checkout "$WT" >&2; }
    # a sha we already have needs no fetch; otherwise fetch from inside the cached tree (FETCH_HEAD is its own)
    if [[ "$REF" =~ ^[0-9a-f]{7,40}$ ]] && SHA="$(git -C "$WT" rev-parse -q --verify "$REF^{commit}")"; then :
    elif GIT_TERMINAL_PROMPT=0 git -C "$WT" fetch -q origin "$REF" 2>/dev/null; then SHA="$(git -C "$WT" rev-parse FETCH_HEAD)"
    else SHA="$(git -C "$WT" rev-parse -q --verify "$REF^{commit}")" || { echo "✗ unknown ref: $REF" >&2; exit 1; }; fi
    git -C "$WT" checkout -q -f --detach "$SHA" >&2
    SETUP="$(pget config.setup)" STAMP="$WT.setup-done"
    if [[ -n "$SETUP" && "$(cat "$STAMP" 2>/dev/null)" != "$SHA $SETUP" ]]; then
      echo "▶ setup in $WT: $SETUP" >&2
      (cd "$WT" && bash -c "$SETUP") >&2 || { echo "✗ setup failed in $WT" >&2; exit 1; }
      echo "$SHA $SETUP" >"$STAMP"
    fi
    echo "✓ $REF @ ${SHA:0:9}" >&2
    echo "$WT"
    exit 0 ;;

  config)
    shift; sync_runner >/dev/null
    config_json "$@"
    exit 0 ;;

  voice)
    shift; sync_runner >/dev/null; ensure_voice
    OUT="$DEMO_HOME/voice/sample.wav"
    echo "▶ Reading it with voice = $(config_json voice | tr -d '\n ')  (the first run downloads the model)"
    DEMO_VOICE_OPTS="$(config_json voice)" "$VOICE_PY" "$SKILL_DIR/runner/voice.py" --say "${1:-Ask the chat for a better description}" "$OUT" >/dev/null 2>&1
    echo "🔊 $(url_of "$OUT")"
    [[ -t 1 ]] && command -v afplay >/dev/null && afplay "$OUT"
    exit 0 ;;

  setup)
    # the only place anything is downloaded for post-production — run it after the user said yes
    shift; [[ "${1:-}" == ffmpeg ]] || { echo "usage: record-demo.sh setup ffmpeg" >&2; exit 1; }
    echo "▶ Downloading a static ffmpeg + ffprobe (~60 MB, one time) into $FF_DIR …" >&2
    mkdir -p "$FF_DIR/bin"
    # its own package.json: npm would otherwise install into $DEMO_HOME/node_modules, which a Playwright reinstall prunes
    [[ -f "$FF_DIR/package.json" ]] || echo '{ "private": true }' >"$FF_DIR/package.json"
    (cd "$FF_DIR" && npm install --silent --no-audit --no-fund ffmpeg-static @ffprobe-installer/ffprobe) \
      || { echo "✗ download failed — install ffmpeg yourself: brew install ffmpeg / apt install ffmpeg" >&2; exit 1; }
    ln -sf "$(cd "$FF_DIR" && node -p 'require("ffmpeg-static")')" "$FF_DIR/bin/ffmpeg"
    ln -sf "$(cd "$FF_DIR" && node -p 'require("@ffprobe-installer/ffprobe").path')" "$FF_DIR/bin/ffprobe"
    "$FF_DIR/bin/ffmpeg" -hide_banner -encoders 2>/dev/null | grep -q libx264 \
      || { echo "✗ the downloaded ffmpeg has no libx264 — install ffmpeg yourself: brew install ffmpeg / apt install ffmpeg" >&2; exit 1; }
    DEMO_FFMPEG="" resolve_ffmpeg
    echo "✓ ffmpeg $("$FFMPEG" -version | head -1 | awk '{print $3}'): $FFMPEG"
    exit 0 ;;

  revoice)
    # re-read a finished take's captions (all, or --line …) with the current voice.* settings; video copied as is
    shift; TAKE="${1:?usage: record-demo.sh revoice <take.mp4> [--line TEXT]… [--say S] [--energy E] [--exaggeration X] [--tries N]}"; shift
    [[ -f "$TAKE" ]] || { echo "✗ Not found: $TAKE" >&2; exit 1; }
    need_ffmpeg; sync_runner >/dev/null; ensure_voice
    OUT="${TAKE%.mp4}"; OUT="${OUT%-revoiced}-revoiced.mp4"  # re-voicing a re-voiced take updates it in place
    echo "▶ Re-voicing $(basename "$TAKE") with voice = $(config_json voice | tr -d '\n ') ${*:+ + $*}"
    DEMO_VOICE_OPTS="$(config_json voice)" "$VOICE_PY" "$SKILL_DIR/runner/revoice.py" "$TAKE" "$OUT" "$@" || exit 1
    echo "🎬 $(url_of "$OUT")"
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
if [[ "$1" == probe ]]; then PROBE=1; SPEC=""
else SPEC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; fi
shift
URL="" AUTH="" SPEED=1 HEADED=() OPEN=0 VOICE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --auth) AUTH="$2"; shift 2 ;;
    --speed) SPEED="$2"; shift 2 ;;
    --headed) HEADED=(--headed); shift ;;
    --open) OPEN=1; shift ;;
    --voice) VOICE=1; shift ;;
    --no-voice) VOICE=0; shift ;;
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
CONFIG="$(config_json)"
[[ -n "$VOICE" ]] || VOICE="$([[ "$(config_json voice.enabled)" == true ]] && echo 1 || echo 0)"
if [[ $VOICE == 1 && $PROBE == 0 ]]; then ensure_voice; else VOICE=0; fi

# Each take gets its own dir: a snapshot of the runner + the raw output (out/). Never shared, never
# reused, removed on exit — so two takes at once (two sessions, two plugin versions) can't clobber
# each other. Playwright resolves @playwright/test by walking up to $DEMO_HOME/node_modules.
RUN_DIR="$(mktemp -d "$DEMO_HOME/runs/XXXXXX")"
trap 'rm -rf "$RUN_DIR"' EXIT
mkdir -p "$RUN_DIR"/{manifest,probe}
for f in "${RUNNER_FILES[@]}"; do cp "$SKILL_DIR/runner/$f" "$RUN_DIR/"; done
cp "$SKILL_DIR/runner/manifest.spec.ts" "$RUN_DIR/manifest/"
cp "$SKILL_DIR/runner/probe.spec.ts" "$RUN_DIR/probe/"
OUT_RAW="$RUN_DIR/out"

RUN_SPEC="$SPEC" MANIFEST=""
[[ $PROBE == 1 ]] && RUN_SPEC="$RUN_DIR/probe/probe.spec.ts"
if [[ "$SPEC" == *.json ]]; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$SPEC" || { echo "✗ $SPEC is not valid JSON" >&2; exit 1; }
  MANIFEST="$SPEC"; RUN_SPEC="$RUN_DIR/manifest/manifest.spec.ts"
fi

[[ $PROBE == 1 ]] || echo "▶ Recording $SPEC against $URL (project: $PNAME) …"
set +e
(cd "$DEMO_HOME" && \
  DEMO_PROBE_SHOT="$DEMO_HOME/probe/probe.png" DEMO_PROBE_DIR="$DEMO_HOME/probe" \
  DEMO_SEGMENTS_FILE="$OUT_RAW/segments.json" DEMO_STEPS_FILE="$OUT_RAW/steps.json" DEMO_CAPTIONS_FILE="$OUT_RAW/captions.json" \
  DEMO_SHOTS_DIR="$OUT_RAW/shots" DEMO_CONFIG="$CONFIG" DEMO_VOICE="${VOICE/0/}" DEMO_VOICE_PY="$VOICE_PY" \
  DEMO_VOICE_SCRIPT="$RUN_DIR/voice.py" DEMO_VOICE_CACHE="$DEMO_HOME/voice/cache" \
  DEMO_PROJECT="$(pget config)" DEMO_MANIFEST="$MANIFEST" \
  DEMO_TEST_DIR="$(dirname "$RUN_SPEC")" DEMO_OUTPUT_DIR="$OUT_RAW" DEMO_TSCONFIG="$RUN_DIR/tsconfig.json" \
  DEMO_SPEED="$SPEED" DEMO_BASE_URL="$URL" DEMO_STORAGE_STATE="$AUTH" DEMO_VIEWPORT="${VIEWPORT:-1680x1050}" DEMO_COLOR_SCHEME="${COLOR:-light}" \
  node_modules/.bin/playwright test "$(basename "$RUN_SPEC")" --config "$RUN_DIR/playwright.config.ts" ${HEADED[@]+"${HEADED[@]}"})
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

if [[ -n "$FFMPEG" ]]; then
  # caption bar + speed / cuts / fast-forward + voice → mp4 (h264/aac plays everywhere), sheet, step frames, chapters
  DURS="$(node "$RUN_DIR/timeline.mjs" "$OUT_RAW" "$WEBM" "$STEM" "$SPEED" "$CONFIG")" || echo "✗ post-production failed (see above)" >&2
  read -r DUR RAW_DUR <<<"${DURS:-}"
fi
[[ -d "$OUT_RAW/shots" ]] && cp -R "$OUT_RAW/shots" "$STEM-shots"

# file:// URLs — plain paths and markdown links aren't clickable in every terminal.
echo ""
echo "━━ RESULT ━━"
if [[ -f "$STEM.mp4" ]]; then
  echo "🎬 video  ${DUR%.*}s from ${RAW_DUR%.*}s raw, ×$SPEED$([[ $VOICE == 1 ]] && echo ', voiced'): $(url_of "$STEM.mp4")"
  echo "🖼  sheet: $(url_of "$STEM-sheet.png")"
else
  echo "🎬 video (raw .webm only — no ffmpeg, so no caption bar, fast-forward, voice or mp4): $(url_of "$STEM.webm")"
  [[ -n "$FFMPEG" ]] || echo "   for the full take: $FF_HINT, then record again"
fi
[[ -d "$STEM-shots" ]] && for f in "$STEM-shots"/*.png; do echo "📸 shot:  $(url_of "$f")"; done
[[ -d "$STEM-steps" ]] && echo "🔎 steps: $(url_of "$STEM-steps") ($(ls "$STEM-steps" | wc -l | tr -d ' ') frames)"
[[ -f "$STEM-chapters.json" ]] && echo "📑 chapters: $(url_of "$STEM-chapters.json") ($(grep -c '"kind"' "$STEM-chapters.json") entries, final-video seconds)"
[[ $OPEN == 1 ]] && { open_file "$STEM.mp4" || open_file "$STEM.webm"; }

[[ $STATUS -eq 0 ]] || echo "⚠ Spec exited $STATUS — the video may stop early. Check the log above."
exit $STATUS
