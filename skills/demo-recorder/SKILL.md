---
name: demo-recorder
description: Record a polished, narrated demo video (human-like cursor, captions, arrow callouts, zoom-ins, clean screenshots) of a flow in ANY running web app from a JSON manifest or a Playwright spec — no changes or dependencies in the target repo — and optionally post it to the PR. Use when the user asks to "record a demo", "make a demo/feature video", "showcase this feature", "record what changed on my branch/PR", "record PR 123", "record a walkthrough of X", or to re-record/adjust an existing demo.
---

# Demo Recorder

Drive a real flow in a running web app with Playwright, overlay a human-looking cursor, captions,
callouts and camera zoom, and get back an `.mp4`, clean screenshots of the key components, and
frames to verify it — then post it to the PR. Works on any web app with a URL. Playwright lives in a
separate runner home (`$DEMO_HOME`, default `~/.demo-recorder`), so the target repo gets **no new
dependencies and no new files** (unless the team opts into a committed `.demo-recorder/` folder).

`S` below = this skill's directory: `${CLAUDE_SKILL_DIR}` when installed as a plugin, otherwise the
directory this SKILL.md lives in. Everything goes through `"$S/record-demo.sh"` (`--help` lists all).

```
$DEMO_HOME/
  config.json                         global settings (look, sharing) — `record-demo.sh config`
  projects/<project>/project.json     per-project settings (URL, start commands, auth, safety)
  projects/<project>/NOTES.md         prose gotchas learned while recording this project
  projects/<project>/demos/*.json     demo manifests (or *.spec.ts) — edit and re-run any time
  auth/<name>.json                    saved logins (owner-only) — never print, copy or upload
  videos/<project>/<demo>-<ts>.mp4    output (+ -shots/ -steps/ -sheet.png .webm)
<repo>/.demo-recorder/project.json    optional TEAM variant of project.json (committed, no `root`)
```

## 0. Project settings — create once, then reuse

`"$S/record-demo.sh" project` shows the resolved settings (team file in the repo wins over the
personal one). None yet → `"$S/record-demo.sh" init` (add `--team` to create the committed variant)
detects the package manager, dev script and framework port, then **finish it by discovery**:

| key | meaning |
|---|---|
| `name` | project id (defaults to the git origin repo name, not the worktree folder) |
| `root` | repo path (personal file only; `up --root <worktree>` overrides per run) |
| `baseUrl` | where the app is served, e.g. `http://localhost:3000` |
| `start[]` | one entry per process: `{ "name", "cwd", "command", "ready", "env" }` — `ready` is a URL that answers once it's up (API first, then UI) |
| `auth` | saved-login name (`auth/<name>.json`) or `null` |
| `viewport` / `colorScheme` | default `1680x1050` (wide = roomy layout) / `light` |
| `forbid` | click-safety: text patterns (`"/delete/i"`, `"Publish"`) a demo must never click |
| `failOn` | locators of error UI (`{ "text": "/something went wrong/i" }`) — waits fail fast on them |
| `localStorage` | key-prefix → value, to pre-dismiss onboarding tours / cookie banners |
| `look` | per-project look override (`{ "hud": { "position": "bottom" } }`) |
| `notes` | short facts; longer prose goes in `NOTES.md` |

Every demo of the project inherits `forbid`, `failOn`, `localStorage`, `look`, `baseUrl`, `auth`,
`viewport` automatically. Read `NOTES.md` too. Update both whenever you learn something.

## 1. Storyboard from the change ("record my branch / PR N")

Derive the flow from the code — don't guess:

```bash
gh pr view <N> --json headRefName,title,body,files      # PR given: its body is the best brief
B=$(git symbolic-ref -q --short refs/remotes/origin/HEAD \
  || { git rev-parse -q --verify origin/main >/dev/null && echo origin/main; } || echo origin/master)
git log --oneline "$B"..HEAD; git diff --stat "$B"...HEAD
git diff "$B"...HEAD -- '*.tsx' '*.jsx' '*.vue' '*.svelte' '*.html' '*.css'
```

- List the user-visible changes; skip pure backend/test/refactor commits unless they change the screen.
- **Deterministic trigger first**: dev hooks, mock modes, `?flag=` params, feature flags, fixtures
  (unit-test fixtures are rarely reachable from the UI — check). **Prove it before scripting**:
  `curl` the endpoint or click it once in a probe; note how long it takes.
- **AI/LLM features**: imperative, fully-specified prompts under ~60 chars. Down (quota 429, no
  creds) or flaky → **replay**: manifest `routes` (or `page.route`) answer the AI endpoints with
  payloads shaped from the app's own response types or captured from one real run. Everything else
  stays live. **Disclose it** on screen and in the PR comment ("AI replies replayed") — a replay must
  never pass for a live check. Seeded data: same rule.
- Guards/confirms ("unsaved changes", "are you sure"): read the guard's condition first to know
  which navigation actually triggers it.
- 4–8 captioned beats: pitch → setup → **the 2–4 moments that ARE the change** (zoom + callout +
  `shot` each) → result. 30–90 s of final video. Found what looks like a product bug? Tell the user.

## 2. Get the RIGHT app running — branch matters

```bash
"$S/record-demo.sh" servers        # :port pid cmd cwd [git branch]  — run this FIRST
"$S/record-demo.sh" up [--root <worktree>]    # starts project.start[] in the background, waits for ready
"$S/record-demo.sh" down                      # stops exactly what `up` started
```

- A server only counts if its `[branch]` is the one being demoed — a server from another worktree
  serves other code and the take silently shows nothing. The user may already run the branch:
  reuse it for read-only flows.
- **Never kill or restart the user's servers.** Need the branch on busy ports? `up --root
  <worktree>` with a project whose `start[]` uses free ports (env/flags: Vite `--port N
  --strictPort`, Next `-p N`, `PORT=N`), pointing the UI at your API via the env/proxy var the dev
  script uses. Port hard-coded in code → a launcher in `$DEMO_HOME/projects/<p>/` that imports the
  entry point and starts it on your port — don't edit the repo.
- **No worktree for the branch** → `git worktree add --detach $DEMO_HOME/worktrees/<p>-<pr> origin/<branch>`,
  install deps there, `git worktree remove` it when done. Fresh worktrees lack deps / `.env` / local
  data: install, or reuse the user's other checkout's venv/.env **read-only** (say so); empty data →
  run the repo's `seed*`/`fixtures` scripts into an **isolated** store, never the user's.
- **Write flows**: check what a submit triggers beyond the DB (grep the diff for `slack`, `notify`,
  `webhook`, `mail`) and switch it off in your isolated stack (env vars, settings).
- Never record against production unless the user explicitly says so. Leave the target worktree
  pristine (`git status` clean, `PYTHONDONTWRITEBYTECODE=1`). Record the working recipe in `start[]`.

## 3. Logged-in apps

```bash
"$S/record-demo.sh" login <name> --from brave --domain app.example.com   # reuse the user's browser login (macOS)
"$S/record-demo.sh" login https://app.example.com/login <name> --browser chrome   # or log in in a real window
```

`--from` reads a temp copy of the browser's cookie DB and decrypts only that domain's cookies with
the browser's Keychain key (macOS asks once — the user clicks Allow; the profile is only read).
Manual login is interactive — ask the user to run it via `! "<S>/record-demo.sh" login …`. Then set
`"auth": "<name>"` in project.json. Expired → you'll see a login page in the frames; redo it.

## 4. Probe what you'll touch

```bash
"$S/record-demo.sh" probe --url http://localhost:3000/some/page     # ARIA tree + probe/probe.png
```

Pick locators from it: role+name, test ids, labels — never CSS chains or nth-child. States you can
only reach by clicking (open dialog, AI result): put `{ "snapshot": "after-x" }` in a draft
manifest at that point — it writes `$DEMO_HOME/probe/after-x.{txt,png}` during the run. Remove it
once the locators work.

## 5. Write the demo — a manifest (default) or a spec

**Manifest** (`projects/<p>/demos/<flow>.json`) — data only, easy for anyone to edit and re-run:

```json
{
  "title": "Bulk edit · rename many items at once",
  "forbid": ["/apply all/i"],
  "routes": [{ "url": "/api/ai/suggest", "method": "POST", "json": { "suggestion": "…" } }],
  "steps": [
    { "goto": "/items" }, { "start": true },
    { "caption": "Bulk edit · rename many items at once", "hold": 2200 },
    { "click": { "role": "checkbox", "name": "Select all" } },
    { "zoom": { "role": "button", "name": "Bulk edit" }, "do": [{ "click": { "role": "button", "name": "Bulk edit" } }] },
    { "type": { "label": "New name" }, "text": "Archived {name}" },
    { "callout": { "testId": "preview" }, "text": "Live preview of every rename" },
    { "shot": "bulk-preview", "target": { "testId": "preview" } },
    { "actAndWait": { "role": "button", "name": "Save" }, "caption": "Saving", "busy": { "css": "[aria-busy=true]" } },
    { "waitFor": { "text": "Saved" } },
    { "caption": "Done", "hold": 2000 }, { "hud": "" }
  ]
}
```

Step types: `goto` `start` `request` `caption` `hud` `click` `tap` `type` `press` `wait` `waitFor`
(`state: hidden`, fast-forwarded) `actAndWait` `zoom` (nested `do`) `callout` `clearCallouts`
`shot` `snapshot`; any step can be `"optional": true`. Top level: `title` `baseUrl` `auth` `forbid` `failOn`
`localStorage` `look` `routes` (`responses: [...]` for sequential polls — last one repeats).
Locators (`LOC`): `"Text"` | `{ role, name, exact }` | `{ testId }` | `{ text }` | `{ label }` |
`{ placeholder }` | `{ css }` + `in` (scope LOC), `nth`, `first`; `"/re/i"` strings are regexes.
Full reference: header of `runner/manifest.spec.ts`.

**Spec** (`.spec.ts`) when you need real logic (loops, branching, computed values):
`import { test, expect, demo } from 'demo-recorder'` — same toolkit: `demo.narrate/hud/click/tap/
slowType/actAndWait/fastForward/withZoom/callout/clearCallouts/shot/snapshot/forbid/failOn/
fakeLocalStorage/configure/loc`.

Baked-in lessons (don't relearn):
- Always move through the wrappers — a raw `locator.click()` desyncs the cursor glide.
- Overlays live on `<html>`, not `<body>` (framework roots reconcile body children away); `start`
  after load; re-`start` after a full navigation.
- **Two levels of text**: captions tell the story; **callouts** point at the exact change (≤ 6 words,
  placed on the free side with an arrow + ring). Inside `zoom`, put the callout in `do`; a callout
  whose target the zoom pushes off-screen belongs after the zoom.
- `zoom` waits for the target to stop reflowing, fits it on screen (wide cards don't crop), zooms a
  `position:fixed` layer (side panel) itself instead of the page, and skips while a dialog is open.
  Zoom only the 2–4 moments that ARE the feature, after async content has fully landed.
- Waits > ~2 s go in `waitFor`/`actAndWait`/`fastForward` → played 8× faster with a ⏩ caption. Never
  pad with fixed sleeps to "wait for" a backend. `failOn` makes waits die in seconds on error UI.
- `type` replaces existing text and caps typing at ~3.5 s; `tap` dispatches for animated elements.
- `shot` = clean still (no cursor/caption; callouts kept unless `callout.inShots` is false), cropped
  to the target + padding, grown to include callout bubbles; its capture moment is cut from the video.
- One-time popups → `localStorage` prefixes (find keys in the app source or DevTools), not clicks.

## 6. Record

```bash
"$S/record-demo.sh" $DEMO_HOME/projects/<p>/demos/<flow>.json [--speed 1.2] [--headed] [--open]
```

URL/auth/viewport come from flags > manifest > project.json. The video is saved even when a step
fails (exit code still reflects it). `--open` on the take you hand back, not while iterating.

## 7. Verify — always, before handing back

1. `-sheet.png` (3×3 across the video): no login page, captions readable, results rendered.
2. `-steps/` — one frame per caption/callout at the moment it was meant to show. Read them.
3. Every `-shots/` still — they ship to the PR.

A green run proves nothing about the screen. Fix and re-record until all three look right.

## 8. Deliver, share, remember

- **Always share the result in the chat**: copy the script's `━━ RESULT ━━` block — plain `file://`
  URLs (markdown links/bare paths aren't clickable in some terminals) — plus one line per beat.
- **Sharing follows settings** (`record-demo.sh config`); `unset` → ask the user once (AskUserQuestion:
  *Always* / *Ask me each time* / *Never*) and save: `config share.pr ask` (also `share.jira`, and
  `share.video` = how the comment carries the video):

  | `share.video` | in the PR comment | needs |
  |---|---|---|
  | `attach` | **plays inline** (GitHub attachment), stills in a 2-col grid | a GitHub web session: `login github --from brave` (GitHub has no API for attachments — `gh`/tokens can't) |
  | `page` | ▶ poster → **one page per PR, one tab per recording**, masonry stills, seekable player | `config share.page.deploy '<cmd with {dir} {slug}>'` + `share.page.url '<https://host/{slug}/>'` (any static host — README → Hosting) |
  | `link` | download link | nothing |

  ```bash
  "$S/record-demo.sh" share <video.mp4> --repo <worktree> --title "…" [--pr N] [--edit <comment-id>] [--dry-run]
  ```
  `ask` → run `--dry-run` first, show the preview, wait for a yes. Stills/poster go to the repo's
  `demo-assets` branch (git plumbing — worktree untouched, no CI); mention it the first time. Page
  mode re-uses one slug per PR (choosing `page` is the standing OK to redeploy *that* slug) and
  remembers the PR comment so later takes edit it. GitHub strips `target=_blank` — say
  "cmd/ctrl-click opens a new tab". Attach videos must be < 10 MB.
- **Jira/issue tracker** (`share.jira`): find candidate keys (`[A-Z][A-Z0-9]+-\d+`) in branch / PR
  title / commits and **confirm each exists** with the tracker tool (`ADR-016`, `UTF-8` look like keys).
  Post the "Jira comment" block `share` printed (links only — never base64 a video through a tool).
- Stop every server you started (`down`), remove temp worktrees, update `project.json` + `NOTES.md`.
