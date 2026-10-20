#!/usr/bin/env bash
#
# share.sh — post a recorded demo (mp4 + demo.shot stills) to the GitHub PR of a worktree.
#   record-demo.sh share <video.mp4> --repo <worktree> [--pr N] [--title "…"] [--video attach|page|link]
#                        [--edit <comment-id>] [--dry-run]
#
# Where the video lives (--video, default: setting share.video):
#   attach — GitHub attachment (user-attachments URL): PLAYS INLINE in the comment. Needs a GitHub
#            web session: `record-demo.sh login github --from brave|chrome` (no API exists for this).
#   page   — a static per-PR page (one tab per recording: video + stills) deployed with YOUR command
#            (settings share.page.deploy / share.page.url — Netlify, S3, GitHub Pages, any static
#            host); the comment shows a clickable ▶ poster linking to it.
#   link   — the mp4 in the assets branch; the comment links it (download only).
# Stills (and the page poster) go to the assets branch (setting share.assetsBranch) unless attach mode uploads them —
# written with git plumbing: no checkout, worktree untouched, no workflow files → no CI.
# Posts one PR comment (or --edit an existing one). Prints a Jira-ready block (links only).
# --dry-run prints the comment, uploads/pushes nothing.

set -euo pipefail

MP4="${1:?usage: record-demo.sh share <video.mp4> --repo <worktree> [--pr N] [--title …] [--dry-run]}"; shift
REPO="" PR="" TITLE="" DRY=0 EDIT="" VIDEO=""
DEMO_HOME="${DEMO_HOME:-$HOME/.demo-recorder}"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GH_AUTH="$DEMO_HOME/auth/github.json"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --pr) PR="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --edit) EDIT="$2"; shift 2 ;;
    --video) VIDEO="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done
[[ -f "$MP4" ]] || { echo "✗ No video: $MP4" >&2; exit 1; }
[[ -d "$REPO" ]] || { echo "✗ --repo <worktree> required" >&2; exit 1; }
MP4="$(cd "$(dirname "$MP4")" && pwd)/$(basename "$MP4")"
cfg() { node "$SKILL_DIR/runner/config.mjs" "$SKILL_DIR/runner/config.defaults.json" "$DEMO_HOME/config.json" "$1"; }
[[ -n "$VIDEO" ]] || VIDEO="$(cfg share.video)"
case "$VIDEO" in attach|page|link) ;; *) echo "✗ --video attach|page|link" >&2; exit 1 ;; esac
ASSETS="$(cfg share.assetsBranch)"; ASSETS="${ASSETS:-demo-assets}"
if [[ $VIDEO == page && -z "$(cfg share.page.deploy)" ]]; then
  echo "✗ page mode needs a deploy command: record-demo.sh config share.page.deploy '<cmd with {dir} {slug}>'" >&2
  echo "  and share.page.url '<https://host/{slug}/>' (see README → Hosting)" >&2; exit 1
fi
# fill {dir} {slug} {repo} {pr} in a template
tpl() { node -e 'const [t,dir,slug,repo,pr]=process.argv.slice(1); console.log(t.replace(/\{(dir|slug|repo|pr)\}/g,(_,k)=>({dir,slug,repo,pr})[k]))' "$1" "${2:-}" "${3:-}" "${4:-}" "${5:-}"; }
if [[ $VIDEO == attach && ! -f "$GH_AUTH" ]]; then
  echo "⚠ No GitHub session for inline video — run: record-demo.sh login https://github.com/login github. Using 'link'." >&2
  VIDEO=link
fi
STEM="${MP4%.mp4}"; NAME="$(basename "$STEM")"
cd "$REPO"

NWO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
BRANCH="$(git branch --show-current)"
[[ -n "$PR" ]] || PR="$(gh pr view --json number -q .number 2>/dev/null || true)"
# detached worktree (e.g. checked out from a PR) → name the folder after the PR's head branch
[[ -n "$BRANCH" && -n "$PR" ]] || [[ -z "$PR" ]] || BRANCH="$(gh pr view "$PR" --repo "$NWO" --json headRefName -q .headRefName)"
[[ -n "$BRANCH" ]] || BRANCH="detached-$(git rev-parse --short HEAD)"
[[ -n "$PR" || $DRY == 1 ]] || { echo "✗ No PR for branch $BRANCH — pass --pr N" >&2; exit 1; }
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MP4" 2>/dev/null | cut -d. -f1)"
SHOTS=(); [[ -d "$STEM-shots" ]] && SHOTS=("$STEM-shots"/*.png)
PREFIX="$BRANCH/$NAME"
SLUG="$(printf 'demo-%s-pr%s' "$(basename "$NWO")" "${PR:-x}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9-' '-' | cut -c1-64)"

declare -a URLS=()   # parallel to SHOTS
POSTER_URL="" PAGE_URL=""
mkdir -p "$DEMO_HOME/gh"

# branch_push <file> <path-in-branch>… — one commit on the assets branch with all of them; sets BASE.
branch_push() {
  if [[ $DRY == 1 ]]; then BASE="https://github.com/$NWO/blob/<commit>"; return; fi
  export GIT_INDEX_FILE; GIT_INDEX_FILE="$(mktemp -u)"
  local parent; parent="$(git ls-remote origin "refs/heads/$ASSETS" | cut -f1)"
  if [[ -n "$parent" ]]; then git fetch -q origin "$ASSETS"; git read-tree "$parent"; fi
  while [[ $# -gt 0 ]]; do git update-index --add --cacheinfo "100644,$(git hash-object -w "$1"),$2"; shift 2; done
  local commit; commit="$(git commit-tree "$(git write-tree)" ${parent:+-p "$parent"} -m "demo: $PREFIX")"
  git push -q origin "${commit}:refs/heads/$ASSETS" 2>/dev/null
  rm -f "$GIT_INDEX_FILE"; unset GIT_INDEX_FILE
  BASE="https://github.com/$NWO/blob/$commit"
}

if [[ $VIDEO == attach ]]; then
  if [[ $DRY == 1 ]]; then
    VIDEO_URL="https://github.com/user-attachments/assets/<video>"
    for f in ${SHOTS[@]+"${SHOTS[@]}"}; do URLS+=("https://github.com/user-attachments/assets/<$(basename "$f")>"); done
  else
    cp "$SKILL_DIR/runner/"{gh-upload.spec.ts,playwright.config.ts} "$DEMO_HOME/gh/"
    OUT="$DEMO_HOME/gh/out.json"; rm -f "$OUT"
    FILES="$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$MP4" ${SHOTS[@]+"${SHOTS[@]}"})"
    (cd "$DEMO_HOME" && DEMO_NO_VIDEO=1 DEMO_TEST_DIR="$DEMO_HOME/gh" DEMO_OUTPUT_DIR="$DEMO_HOME/gh/results" \
      DEMO_STORAGE_STATE="$GH_AUTH" GH_PR_URL="https://github.com/$NWO/pull/$PR" GH_UPLOAD_FILES="$FILES" GH_UPLOAD_OUT="$OUT" \
      npx playwright test gh-upload.spec.ts --config gh/playwright.config.ts --reporter=line) >&2 \
      || { echo "✗ GitHub upload failed (session expired? re-run: record-demo.sh login https://github.com/login github)" >&2; exit 1; }
    get() { node -e 'console.log(require(process.argv[1])[process.argv[2]] ?? "")' "$OUT" "$1"; }
    VIDEO_URL="$(get "$(basename "$MP4")")"
    for f in ${SHOTS[@]+"${SHOTS[@]}"}; do URLS+=("$(get "$(basename "$f")")"); done
  fi
else
  PUSH=()
  for f in ${SHOTS[@]+"${SHOTS[@]}"}; do PUSH+=("$f" "$PREFIX/shots/$(basename "$f")"); done
  if [[ $VIDEO == page ]]; then
    # ONE page per PR (stable slug); each share adds a tab (take) — earlier takes stay.
    PAGE="$DEMO_HOME/pages/$SLUG"
    PAGE_URL="$(tpl "$(cfg share.page.url)" "$PAGE" "$SLUG" "$NWO" "$PR")"
    TAKE_ID="$(date -u +%Y%m%d-%H%M%S)"
    cp "$SKILL_DIR/runner/poster.mjs" "$DEMO_HOME/gh/"
    ffmpeg -loglevel error -y -ss "$(( ${DUR:-10} * 45 / 100 ))" -i "$MP4" -frames:v 1 "$DEMO_HOME/gh/frame.png"
    (cd "$DEMO_HOME" && node gh/poster.mjs gh/frame.png gh/poster.png "Play the demo · ${DUR:-?}s")
    PUSH+=("$DEMO_HOME/gh/poster.png" "$PREFIX/poster.png")
    if [[ $DRY == 0 ]]; then
      # another machine may have started this PR's page — pull it (optional command) so its tabs survive
      PULL="$(cfg share.page.pull)"
      [[ -f "$PAGE/takes.json" || -z "$PULL" ]] || bash -c "$(tpl "$PULL" "$PAGE" "$SLUG" "$NWO" "$PR")" >/dev/null 2>&1 || true
      TD="$PAGE/takes/$TAKE_ID"; mkdir -p "$TD/shots"; cp "$MP4" "$TD/demo.mp4"
      for f in ${SHOTS[@]+"${SHOTS[@]}"}; do cp "$f" "$TD/shots/"; done
      TAKE="$(node -e '
        const [id, sha, subject, title, dur, ...shots] = process.argv.slice(1);
        console.log(JSON.stringify({ id, sha, subject, title, dur: Number(dur) || null, date: new Date().toISOString(),
          video: `takes/${id}/demo.mp4`,
          shots: shots.map((f) => ({ file: `takes/${id}/shots/${f}`, caption: f.replace(/^\d+-/, "").replace(/\.png$/, "").replace(/-/g, " ") })) }));' \
        "$TAKE_ID" "$(git rev-parse --short HEAD)" "$(git log -1 --format=%s)" "${TITLE:-Demo: $BRANCH}" "${DUR:-}" \
        ${SHOTS[@]+$(for f in "${SHOTS[@]}"; do basename "$f"; done)})"
      META="$(node -e 'const [repo, pr, branch, title] = process.argv.slice(1); console.log(JSON.stringify({ repo, pr, branch, title,
        prUrl: pr ? `https://github.com/${repo}/pull/${pr}` : undefined }))' \
        "$NWO" "$PR" "$BRANCH" "$( [[ -n "$PR" ]] && gh pr view "$PR" --repo "$NWO" --json title -q .title || echo "Demo: $BRANCH")")"
      node "$SKILL_DIR/runner/page.mjs" "$PAGE" add "$TAKE" "$META" >/dev/null
      [[ -n "$EDIT" ]] || EDIT="$(node "$SKILL_DIR/runner/page.mjs" "$PAGE" get commentId)"
      OUTPUT="$(bash -c "$(tpl "$(cfg share.page.deploy)" "$PAGE" "$SLUG" "$NWO" "$PR")" 2>&1)" \
        || { echo "✗ page deploy failed:"; echo "$OUTPUT" | tail -5; exit 1; } >&2
      # the deploy command may print the real URL — prefer the last http(s) URL it printed
      PRINTED="$(echo "$OUTPUT" | grep -oE 'https?://[^"[:space:]]+' | tail -1 || true)"
      [[ -n "$PAGE_URL" ]] || PAGE_URL="$PRINTED"
      [[ -n "$PAGE_URL" ]] || { echo "✗ no page URL — set share.page.url '<https://host/{slug}/>'" >&2; exit 1; }
    fi
    VIDEO_URL="${PAGE_URL}#${TAKE_ID}"
  else
    PUSH+=("$MP4" "$PREFIX/$NAME.mp4")
  fi
  branch_push ${PUSH[@]+"${PUSH[@]}"}
  for f in ${SHOTS[@]+"${SHOTS[@]}"}; do URLS+=("$BASE/$PREFIX/shots/$(basename "$f")?raw=true"); done
  [[ $VIDEO == page ]] && POSTER_URL="$BASE/$PREFIX/poster.png?raw=true"
  [[ $VIDEO == link ]] && VIDEO_URL="$BASE/$PREFIX/$NAME.mp4?raw=true"
fi

BODY="$(mktemp)"
{
  echo "### 🎬 ${TITLE:-Demo: $BRANCH}"
  echo ""
  case "$VIDEO" in
    attach) echo "$VIDEO_URL"     # bare attachment URL on its own line = inline player
            # this PR already has a history page → point to it
            HIST="$(tpl "$(cfg share.page.url)" "" "$SLUG" "$NWO" "$PR")"
            [[ -f "$DEMO_HOME/pages/$SLUG/takes.json" && -n "$HIST" ]] && { echo ""; echo "Every recording of this PR: $HIST"; } ;;
    page) echo "<a href=\"$VIDEO_URL\"><img src=\"$POSTER_URL\" alt=\"Play the demo\" width=\"900\"></a>"
           echo ""; echo "**[▶ Play the latest demo (${DUR:-?}s)]($VIDEO_URL)** · every recording of this PR is a tab there (cmd/ctrl-click for a new tab)" ;;
    link) echo "**[▶ Watch the demo (${DUR:-?}s, mp4)]($VIDEO_URL)**" ;;
  esac
  # stills: 2-column grid (GitHub markdown has tables, not CSS) — captions under each image
  if [[ ${#SHOTS[@]} -gt 0 ]]; then
    echo ""; echo "<table>"
    for i in "${!SHOTS[@]}"; do
      n="$(basename "${SHOTS[$i]}" .png)"; n="${n#??-}"; n="${n//-/ }"
      (( i % 2 == 0 )) && echo "<tr>"
      echo "<td valign=\"top\" width=\"50%\"><a href=\"${URLS[$i]}\"><img src=\"${URLS[$i]}\" alt=\"$n\"></a><br><sub>$n</sub></td>"
      (( i % 2 == 1 || i == ${#SHOTS[@]} - 1 )) && echo "</tr>"
    done
    echo "</table>"
  fi
  echo ""
  echo "<sub>Recorded with demo-recorder against branch \`$BRANCH\`.</sub>"
} > "$BODY"

if [[ $DRY == 1 ]]; then
  echo "── PR #${PR:-?} comment (dry run, nothing pushed) ──"; cat "$BODY"
else
  if [[ -n "$EDIT" ]]; then
    URL="$(gh api -X PATCH "repos/$NWO/issues/comments/$EDIT" -F body=@"$BODY" -q .html_url)"
  else
    URL="$(gh pr comment "$PR" --repo "$NWO" --body-file "$BODY")"
  fi
  echo "✓ PR comment (video: $VIDEO): $URL"
  [[ $VIDEO == page && $URL == *issuecomment-* ]] && node "$SKILL_DIR/runner/page.mjs" "$PAGE" set commentId "${URL##*issuecomment-}"
  [[ -n "$PAGE_URL" ]] && echo "✓ Page: $PAGE_URL"
fi

echo ""
echo "── Jira comment (post via the Jira tool) ──"
echo "Demo video (${DUR:-?}s): $VIDEO_URL"
for i in ${SHOTS[@]+"${!SHOTS[@]}"}; do echo "Screenshot $(basename "${SHOTS[$i]}" .png): ${URLS[$i]}"; done
[[ -n "$PR" ]] && echo "PR: https://github.com/$NWO/pull/$PR"
rm -f "$BODY"
