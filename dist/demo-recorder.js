"use strict";
/**
 * Demo-recorder — project-agnostic helpers for narrated demo-video Playwright specs.
 *
 * A macOS-arrow cursor that glides human-like, an on-screen caption HUD, local callouts with arrows,
 * visible typing, camera zoom on pivotal moments, clean stills, and waits that fast-forward in the
 * final video. Specs import ONLY this file (it re-exports `test`/`expect`), so the target repo needs
 * no Playwright install:
 *
 *   import { test, expect, demo } from 'demo-recorder';   // alias set up by the runner
 *   test('flow', async ({ page }) => {
 *     await page.goto('/');
 *     await demo.startRecording(page);
 *     await demo.narrate(page, 'Step 1 · …');
 *     await demo.click(page, page.getByRole('button', { name: 'Save' }));
 *   });
 *
 * See SKILL.md for the recipe. Project defaults (project.json: forbid, failOn, localStorage, look)
 * are applied automatically by the `test` fixture below.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.demo = exports.DRY_RUN = exports.test = exports.expect = void 0;
exports.re = re;
exports.loc = loc;
exports.begin = begin;
exports.saveTimeline = saveTimeline;
exports.configure = configure;
exports.readMs = readMs;
exports.spoken = spoken;
exports.resetCursor = resetCursor;
exports.installCursor = installCursor;
exports.startRecording = startRecording;
exports.fakeLocalStorage = fakeLocalStorage;
exports.hud = hud;
exports.callout = callout;
exports.clearCallouts = clearCallouts;
exports.narrate = narrate;
exports.humanMove = humanMove;
exports.moveTo = moveTo;
exports.parkCursor = parkCursor;
exports.forbid = forbid;
exports.failOn = failOn;
exports.click = click;
exports.tap = tap;
exports.slowType = slowType;
exports.clickIfShown = clickIfShown;
exports.shot = shot;
exports.snapshot = snapshot;
exports.fastForward = fastForward;
exports.actAndWait = actAndWait;
exports.zoomToPoint = zoomToPoint;
exports.zoomOut = zoomOut;
exports.withZoom = withZoom;
const test_1 = require("@playwright/test");
Object.defineProperty(exports, "expect", { enumerable: true, get: function () { return test_1.expect; } });
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_readline_1 = require("node:readline");
// Fast-forward segments (seconds from video start), written for record-demo.sh to speed up in
// post. Video starts with the page, so t0 is taken when the `page` fixture is handed over.
let t0 = Date.now();
const segments = []; // label = the shot a cut is for
const steps = []; // caption/callout → one verify-frame each (at = frame time)
const captions = []; // every caption change → the bar + voice track
let shotCount = 0;
let forbidden = [];
let failWatch = [];
const project = (() => {
    try {
        return JSON.parse(process.env.DEMO_PROJECT || '{}');
    }
    catch {
        return {};
    }
})();
/** "/re/i" → RegExp; anything else unchanged. */
function re(v) {
    const m = typeof v === 'string' && /^\/(.+)\/([a-z]*)$/.exec(v);
    return m ? new RegExp(m[1], m[2]) : v;
}
/** One locator language for specs, manifests and project.json:
 *  "Button text" | { role, name, exact } | { testId } | { text } | { label } | { placeholder } |
 *  { css } — plus optional "in": LOC (scope), "nth": n, "first": true. "/re/i" strings are regexes. */
function loc(page, l) {
    if (typeof l === 'string')
        return page.getByText(re(l));
    const root = l.in ? loc(page, l.in) : page;
    let x;
    if (l.role)
        x = root.getByRole(l.role, { ...(l.name !== undefined && { name: re(l.name) }), ...(l.exact && { exact: true }) });
    else if (l.testId)
        x = root.getByTestId(re(l.testId));
    else if (l.label)
        x = root.getByLabel(re(l.label), { exact: !!l.exact });
    else if (l.placeholder)
        x = root.getByPlaceholder(re(l.placeholder));
    else if (l.text)
        x = root.getByText(re(l.text), { exact: !!l.exact });
    else if (l.css)
        x = root.locator(l.css);
    else
        throw new Error(`bad locator ${JSON.stringify(l)}`);
    if (l.nth !== undefined)
        x = x.nth(l.nth);
    if (l.first)
        x = x.first();
    return x;
}
/** Patterns for forbid(): "/re/i" or plain text (case-insensitive substring). */
const toPattern = (f) => f instanceof RegExp ? f : re(f) instanceof RegExp ? re(f) : new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
/** Start a take's timeline: call right after the page (and so its video) is created. The `test`
 *  fixture does this for you; a repo driving its own Playwright fixtures calls it itself, then
 *  `saveTimeline(dir)` at the end and `record-demo.sh finish <dir>` for the caption bar, fast-forward
 *  and mp4 — or keeps the default in-page captions and needs neither. */
function begin() {
    t0 = Date.now();
    segments.length = 0;
    steps.length = 0;
    captions.length = 0;
    lastCaption = '';
    lastStepAt = null;
    captionNeedMs = 0;
    captionCount = 0;
    shotCount = 0;
    forbidden = [];
    failWatch = [];
}
/** Write the take's timeline for post-production: `captions.json` (+ the look), `segments.json`
 *  (fast-forwards and cuts), `steps.json` (one verify-frame per caption/callout). Pass a directory
 *  (the one holding the take's .webm, for `record-demo.sh finish <dir>`) or explicit file paths. */
function saveTimeline(to) {
    const f = typeof to === 'string' ? { captions: (0, node_path_1.join)(to, 'captions.json'), segments: (0, node_path_1.join)(to, 'segments.json'), steps: (0, node_path_1.join)(to, 'steps.json') } : to;
    if (typeof to === 'string')
        (0, node_fs_1.mkdirSync)(to, { recursive: true });
    // the bar is drawn in post — hand it the look this spec ended up with (project/manifest/configure overrides)
    if (f.captions)
        (0, node_fs_1.writeFileSync)(f.captions, JSON.stringify({ hud: hudCfg, accent: hudCfg.accent ?? calloutCfg.color, captions }));
    if (f.segments)
        (0, node_fs_1.writeFileSync)(f.segments, JSON.stringify(segments));
    if (f.steps)
        (0, node_fs_1.writeFileSync)(f.steps, JSON.stringify(steps));
}
/** Playwright `test`, plus fast-forward bookkeeping and project defaults. Use this one, not
 *  '@playwright/test'. */
exports.test = test_1.test.extend({
    page: async ({ page }, use) => {
        begin();
        if (project.look)
            configure(project.look);
        if (project.forbid?.length)
            forbid(project.forbid);
        if (project.failOn?.length)
            failOn(...project.failOn.map((l) => loc(page, l)));
        if (project.localStorage && Object.keys(project.localStorage).length)
            await fakeLocalStorage(page, project.localStorage);
        await use(page);
        await letCaptionBeRead(page).catch(() => { }); // the last caption (and its voice) gets its full time on screen
        tts?.proc.kill();
        tts = null;
        saveTimeline({
            captions: process.env.DEMO_CAPTIONS_FILE,
            segments: process.env.DEMO_SEGMENTS_FILE,
            steps: process.env.DEMO_STEPS_FILE,
        });
        const minutes = (Date.now() - t0) / 60_000;
        if (captionCount / Math.max(minutes, 0.5) > 12)
            console.warn(`[caption-lint] ${captionCount} captions in ${minutes.toFixed(1)} min — combine beats; let callouts point at details`);
    },
});
const HUD_ID = 'demo-hud';
const CURSOR_ID = 'demo-cursor';
const CALLOUTS_ID = 'demo-callouts';
let calloutGroups = 0;
const userCfg = (() => {
    try {
        return JSON.parse(process.env.DEMO_CONFIG || '{}');
    }
    catch {
        return {};
    }
})();
// Under record-demo.sh the caption bar is drawn in post (DEMO_CAPTIONS_FILE is set). Imported into a repo's
// own Playwright harness nothing draws it afterwards, so captions go on the page instead.
const POST_PRODUCTION = !!process.env.DEMO_CAPTIONS_FILE;
let hudCfg = { position: POST_PRODUCTION ? 'top' : 'overlay', size: 'md', theme: 'dark', wpm: 180, minMs: 1500, readingTime: true, hold: 1200, ...userCfg.hud };
let calloutCfg = { color: '#f43f5e', ring: true, inShots: true, ...userCfg.callout };
let motionCfg = { zoom: 1, cursor: 1, pop: false, pace: 1, typeCapMs: 3500, ...userCfg.motion };
/** Per-spec override of the persisted look, e.g. `demo.configure({ hud: { position: 'bottom' } })`. */
function configure(o) {
    hudCfg = { ...hudCfg, ...o.hud };
    calloutCfg = { ...calloutCfg, ...o.callout };
    motionCfg = { ...motionCfg, ...o.motion };
}
// In-page helper: rects of UI a caption must not cover. Re-installed per call (navigation wipes it).
const PAGE_HELPERS = `window.__demoImportant = () => {
  const sel = 'button,a[href],input,textarea,select,[role=button],[role=tab],[role=menuitem],h1,h2,h3,img,[role=dialog],[data-hook],[data-testid]';
  const own = new Set(['${HUD_ID}', '${CURSOR_ID}', '${CALLOUTS_ID}']);
  return [...document.querySelectorAll(sel)].filter((e) => !own.has(e.id) && !e.closest('#${CALLOUTS_ID}'))
    .map((e) => e.getBoundingClientRect()).filter((r) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight);
};
window.__demoOverlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.height) - Math.max(a.y, b.y));`;
// Tracks the fake cursor position so humanMove() eases FROM the current spot. ALWAYS move through
// these wrappers; a raw Playwright `.click()` moves the real mouse without updating this, so the next
// glide would start from the wrong place.
let mouse = { x: 760, y: 480 };
// Wall-clock of the last caption change, so every hud()/narrate() logs how long the PRECEDING step
// took — a per-step timing trail in the run log, so a stuck/slow step is visible without the video.
let lastStepAt = null;
let lastCaption = '';
// Minimum reading time: the caption on screen must stay up for `captionNeedMs` (real time, scaled by
// --speed so it's still readable in the final video) before anything replaces or fast-forwards it.
let captionShownAt = 0;
let captionNeedMs = 0;
let captionCount = 0;
const SPEED = Number(process.env.DEMO_SPEED) || 1;
// `record-demo.sh --dry-run`: check a demo's logic without filming it — no video, no post-production,
// every on-camera pause / glide / typed character instant, short action timeout. A broken locator fails
// in seconds instead of after a full take. Waits on the app itself (waitFor, actAndWait) stay real.
exports.DRY_RUN = process.env.DEMO_DRY_RUN === '1';
/** × every on-camera pause: motion.pace, 0 in a dry run. */
const pace = () => (exports.DRY_RUN ? 0 : Math.max(0, Number(motionCfg.pace ?? 1)));
/** The one way the toolkit pauses on camera: scaled by motion.pace, skipped at pace 0 (dry run). */
async function wait(page, ms) {
    const scaled = Math.round(ms * pace());
    if (scaled > 0)
        await page.waitForTimeout(scaled);
}
/** How long `text` must be visible to be read: base + words at hud.wpm, clamped to [minMs, 7s],
 *  scaled by --speed (a 1.5× video needs 1.5× the real time). */
function readMs(text) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const ms = Math.min(7000, Math.max(Number(hudCfg.minMs) || 1500, 700 + (words * 60_000) / (Number(hudCfg.wpm) || 180)));
    return Math.round(ms * SPEED);
}
/** Wait until the current caption has had its reading time. */
async function letCaptionBeRead(page) {
    const left = captionNeedMs - (Date.now() - captionShownAt);
    if (lastCaption && left > 0)
        await wait(page, left);
}
/** Cut [start, now] out of the final video. The caption on screen loses that time, so its
 *  reading-time clock is pushed back by the same amount. */
function cutSince(start, label) {
    const end = (Date.now() - t0) / 1000;
    segments.push({ start, end, factor: 1000, ...(label && { label }) });
    captionShownAt += (end - start) * 1000;
}
// ── Voice (record-demo.sh --voice): each caption read aloud by Chatterbox TTS ──
// Clips are cached by text + voice settings, so a re-take only synthesises captions that changed; the
// seconds spent synthesising are cut from the video. The caption stays up until its clip has played.
// Delivery — voice.energy (calm → rainbow) plus optional exaggeration/cfg/temperature overrides — is
// resolved by voice.py; the whole config is part of the cache key.
const VOICE = process.env.DEMO_VOICE ? { energy: 'upbeat', ref: '', ...userCfg.voice } : null;
let tts = null;
/** Caption → what the voice should say: symbols read out or dropped. */
function spoken(text) {
    const t = text
        .replace(/[⏩✓✔]/gu, '')
        .replace(/\s*[·—–|]\s*/g, ', ')
        .replace(/\s*→\s*/g, ' to ')
        .replace(/#(?=\d)/g, '')
        .replace(/[\s,]+$/, '')
        .trim();
    return t;
}
async function voiceFor(text, line) {
    if (line === false)
        return null;
    const { say = spoken(text), ...over } = line ?? {};
    if (!VOICE || !say)
        return null;
    const opts = { ...VOICE, ...over };
    const dir = process.env.DEMO_VOICE_CACHE;
    // tts: bump when voice.py changes how a line is read, so cached clips are re-synthesised
    const file = (0, node_path_1.join)(dir, `${(0, node_crypto_1.createHash)('sha1').update(JSON.stringify({ say, ...opts, tts: 3 })).digest('hex').slice(0, 16)}.wav`);
    if ((0, node_fs_1.existsSync)(`${file}.json`))
        return { file, ms: JSON.parse((0, node_fs_1.readFileSync)(`${file}.json`, 'utf8')).ms };
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    if (!tts) {
        console.log('[voice] loading Chatterbox…');
        const proc = (0, node_child_process_1.spawn)(process.env.DEMO_VOICE_PY, [process.env.DEMO_VOICE_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
        proc.stderr.on('data', (d) => /error|Traceback/i.test(String(d)) && process.stderr.write(d)); // keep progress bars out of the log
        tts = { proc, replies: (0, node_readline_1.createInterface)({ input: proc.stdout })[Symbol.asyncIterator]() };
    }
    tts.proc.stdin.write(`${JSON.stringify({ ...opts, text: say, out: file })}\n`);
    const { value, done } = await tts.replies.next();
    const r = done ? { error: 'voice worker exited' } : JSON.parse(value);
    if (r.error) {
        console.warn(`[voice] "${say}": ${r.error}`);
        return null;
    }
    const ms = Math.round(r.seconds * 1000);
    (0, node_fs_1.writeFileSync)(`${file}.json`, JSON.stringify({ ms, say }));
    return { file, ms };
}
/** Reset the cursor tracker. Call at the top of every spec. */
function resetCursor(x = 760, y = 480) {
    mouse = { x, y };
    lastStepAt = null;
}
/** Inject a macOS-style arrow cursor that follows real mouse movements. Idempotent. Appended to
 *  `<html>`, not `<body>` (React/Next/Vue roots reconcile body children away), and must run AFTER
 *  hydration (pre-hydration injection can trigger a hydration mismatch). Re-call after a full
 *  navigation — it no-ops if the cursor already exists. */
async function installCursor(page) {
    await page
        .evaluate((id) => {
        if (document.getElementById(id))
            return;
        const c = document.createElement('div');
        c.id = id;
        c.style.cssText = [
            'position:fixed',
            'left:-100px',
            'top:-100px',
            'width:22px',
            'height:28px',
            'z-index:2147483647',
            'pointer-events:none',
            'filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))',
            'transition:transform .08s ease',
        ].join(';');
        // macOS arrow — tip at (0,0) so left/top can be set straight to the pointer coords.
        c.innerHTML =
            '<svg width="22" height="28" viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M0 0 L0 21 L5.4 16.2 L8.9 23.7 L11.9 22.3 L8.5 15 L15.6 15 Z" ' +
                'fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
        document.documentElement.appendChild(c);
        document.addEventListener('mousemove', (e) => {
            c.style.left = `${e.clientX}px`;
            c.style.top = `${e.clientY}px`;
        }, { passive: true });
        document.addEventListener('mousedown', () => (c.style.transform = 'scale(.85)'), { passive: true });
        document.addEventListener('mouseup', () => (c.style.transform = 'scale(1)'), { passive: true });
    }, CURSOR_ID)
        .catch(() => { });
}
/** After goto: settle + hydrate, then install the cursor. The canonical opener for a recorded flow. */
async function startRecording(page, hydrateMs = 1200) {
    // capped: apps that poll or hold a websocket never reach networkidle
    await page.waitForLoadState('networkidle', { timeout: pace() === 0 ? 2000 : 8000 }).catch(() => { });
    await wait(page, hydrateMs);
    await installCursor(page);
    // First call: cut the blank/loading lead-in so the video opens on the rendered app.
    if (!steps.length && !segments.length)
        segments.push({ start: 0, end: (Date.now() - t0) / 1000, factor: 1000 });
}
/** Make the app believe one-time UI (onboarding tours, "what's new" callouts, cookie banners) was
 *  already seen, so it can never pop up mid-recording and swallow a click. Patches
 *  `localStorage.getItem` — every key starting with a map key returns that value. Waiting for the
 *  popup and clicking "Okay" races its own mount timing; this doesn't. Call ONCE before the first
 *  `page.goto` (addInitScript re-applies on every navigation). Find the keys in the app's source or
 *  DevTools → Application → Local Storage after dismissing the popup manually. */
async function fakeLocalStorage(page, values) {
    await page.addInitScript((map) => {
        const original = window.localStorage.getItem.bind(window.localStorage);
        window.localStorage.getItem = (key) => {
            const hit = Object.keys(map).find((prefix) => key.startsWith(prefix));
            return hit !== undefined ? map[hit] : original(key);
        };
    }, values);
}
/** Show a caption — the step title in the bar above the page (or on the page with
 *  `hud.position: overlay`). Each call is a "step": logged with the previous step's duration, and
 *  record-demo.sh saves one verify-frame per step. With --voice the caption is also read aloud and
 *  stays up until its clip has played. */
async function hud(page, text, opts = {}) {
    if (text === lastCaption)
        return;
    await letCaptionBeRead(page); // never cut the previous caption short
    const synthAt = (Date.now() - t0) / 1000;
    const voice = text ? await voiceFor(text, opts.voice) : null;
    if (Date.now() - t0 > synthAt * 1000 + 50)
        cutSince(synthAt); // synthesis time never shows in the video
    const now = Date.now();
    if (text) {
        captionCount++;
        const words = text.trim().split(/\s+/).length;
        if (words > 12)
            console.warn(`[caption-lint] ${words} words — aim for ≤ 8, one idea; move detail into a callout: "${text}"`);
    }
    captionShownAt = now;
    captionNeedMs = text && hudCfg.readingTime !== false ? Math.max(readMs(text), voice ? Math.round((voice.ms + 400) * SPEED) : 0) : 0;
    const deltaMs = lastStepAt === null ? 0 : now - lastStepAt;
    console.log(`[step +${(deltaMs / 1000).toFixed(1)}s] ${text}`);
    lastStepAt = now;
    lastCaption = text;
    // say + voice: what this line's voice reads and how — revoice reads it again the same way
    if (text)
        steps.push({ t: (now - t0) / 1000, text, say: opts.voice === false ? '' : (opts.voice?.say ?? spoken(text)), ...(opts.voice !== undefined && { voice: opts.voice }) });
    await paint(page, text, voice?.file);
}
// Caption only — no step log/timing (used for transient tweaks like the ⏩ marker). Logs the change
// for the bar/voice track; draws it on the page only in overlay mode.
async function paint(page, text, voice) {
    captions.push({ t: (Date.now() - t0) / 1000, text, ...(voice && { voice }) });
    if (hudCfg.position !== 'overlay')
        return;
    await page
        .evaluate(({ id, t, cfg }) => {
        const SIZES = { sm: [14, '10px 18px', 10], md: [17, '14px 26px', 14], lg: [22, '18px 32px', 16] };
        const [font, pad, radius] = SIZES[cfg.size] ?? SIZES.md;
        const light = cfg.theme === 'light';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            document.documentElement.appendChild(el); // outside framework-managed <body>
        }
        el.style.cssText = [
            'position:fixed',
            'top:28px',
            'left:50%',
            'transform:translateX(-50%)',
            'z-index:2147483647',
            `background:${cfg.background ?? (light ? 'rgba(255,255,255,.97)' : 'rgba(17,24,39,.94)')}`,
            `color:${cfg.color ?? (light ? '#111827' : '#fff')}`,
            `padding:${pad}`,
            `border-radius:${radius}px`,
            `font:${cfg.weight ?? 600} ${font}px/1.35 ${cfg.font ?? "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"}`,
            'letter-spacing:.2px',
            `box-shadow:0 10px 34px rgba(0,0,0,${light ? '.18' : '.45'})`,
            `border:1px solid ${light ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.12)'}`,
            'max-width:72vw',
            'text-align:center',
            'pointer-events:none',
            'transition:opacity .25s ease',
            `opacity:${t ? 1 : 0}`,
            cfg.css ?? '',
        ].join(';');
        el.textContent = t;
    }, { id: HUD_ID, t: text, cfg: hudCfg })
        .catch(() => { });
}
/** A LOCAL label pointing at the change: bubble placed on the free side of `target` (right, left,
 *  below, above — whichever covers least important UI and stays on screen), an arrow to it, and a
 *  ring around it. Pairs with the global caption: caption = what's happening, callout = look HERE.
 *  Holds `holdMs`, then clears (`keep: true` leaves it until `clearCallouts` / zoomOut / next
 *  `callout` with `replace`). Inside `withZoom`, call it in the action — it's drawn in zoomed
 *  coordinates. Shown in `shot()` stills unless `callout.inShots` is false. While shown it follows
 *  `target` when the page scrolls or reflows (output arriving, async lists) — see followTarget. */
async function callout(page, target, text, opts = {}) {
    const { keep = false, ring = calloutCfg.ring, replace = true } = opts;
    const holdMs = Math.max(opts.holdMs ?? 0, readMs(text)); // never shorter than its reading time
    await reveal(page, target);
    const box = await stableBox(page, target);
    if (!box)
        return;
    const now = (Date.now() - t0) / 1000;
    steps.push({ t: now, text: `↳ ${text}`, at: now + Math.min(holdMs, 3000) / 1000 * 0.6 }); // frame mid-hold
    console.log(`[callout] ${text}`);
    const gid = String(++calloutGroups);
    await page.evaluate(PAGE_HELPERS).catch(() => { });
    await page
        .evaluate(({ id, hudId, r, text, color, ring, replace, gid, look, pop }) => {
        let layer = document.getElementById(id);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = id;
            layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none';
            document.documentElement.appendChild(layer);
        }
        if (replace)
            layer.innerHTML = '';
        const group = document.createElement('div');
        group.dataset.demoGroup = gid;
        group.style.cssText = 'position:absolute;inset:0;opacity:0;transition:opacity .3s ease,transform .1s linear';
        layer.appendChild(group);
        const bubble = document.createElement('div');
        bubble.dataset.demoBubble = '1';
        bubble.textContent = text;
        bubble.style.cssText = [
            'position:absolute',
            'max-width:300px',
            `background:${color}`,
            `color:${look.textColor ?? '#fff'}`,
            `font:600 15px/1.35 ${look.font ?? "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"}`,
            'padding:9px 14px',
            'border-radius:10px',
            'box-shadow:0 8px 24px rgba(0,0,0,.28)',
            look.css ?? '',
        ].join(';');
        group.appendChild(bubble);
        const w = bubble.offsetWidth;
        const h = bubble.offsetHeight;
        // pick the side with the least important UI under the bubble; never off-screen
        const gap = 56;
        const m = 12;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const sides = [
            { x: r.x + r.width + gap, y: cy - h / 2 },
            { x: r.x - gap - w, y: cy - h / 2 },
            { x: cx - w / 2, y: r.y + r.height + gap },
            { x: cx - w / 2, y: r.y - gap - h },
        ];
        const important = window.__demoImportant();
        const overlap = window.__demoOverlap;
        const hud = document.getElementById(hudId)?.getBoundingClientRect();
        const best = sides
            .map((p) => {
            const fits = p.x >= m && p.y >= m && p.x + w <= innerWidth - m && p.y + h <= innerHeight - m;
            const q = {
                x: Math.min(Math.max(p.x, m), innerWidth - w - m),
                y: Math.min(Math.max(p.y, m), innerHeight - h - m),
                w,
                h,
            };
            const cost = important.reduce((n, e) => n + overlap(q, e), 0) +
                overlap(q, r) * 100 +
                (hud ? overlap(q, hud) * 100 : 0) +
                (fits ? 0 : 1e7);
            return { ...q, cost };
        })
            .sort((a, b) => a.cost - b.cost)[0];
        bubble.style.left = `${best.x}px`;
        bubble.style.top = `${best.y}px`;
        // arrow: from the bubble's edge to the target's edge, along the centre-to-centre line
        const edge = (bx, by, bw, bh, tx, ty) => {
            const ox = bx + bw / 2;
            const oy = by + bh / 2;
            const dx = tx - ox;
            const dy = ty - oy;
            const k = Math.min(dx ? bw / 2 / Math.abs(dx) : Infinity, dy ? bh / 2 / Math.abs(dy) : Infinity);
            return [ox + dx * k, oy + dy * k];
        };
        const [x1, y1] = edge(best.x, best.y, w, h, cx, cy);
        const pad = ring ? 8 : 4;
        const [x2, y2] = edge(r.x - pad, r.y - pad, r.width + pad * 2, r.height + pad * 2, best.x + w / 2, best.y + h / 2);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(innerWidth));
        svg.setAttribute('height', String(innerHeight));
        svg.style.cssText = 'position:absolute;inset:0;overflow:visible';
        const mid = `demo-arrow-${Math.random().toString(36).slice(2)}`;
        svg.innerHTML =
            `<defs><marker id="${mid}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
                `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/></marker></defs>` +
                `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="3" stroke-linecap="round" marker-end="url(#${mid})"/>`;
        group.appendChild(svg);
        if (ring) {
            const o = document.createElement('div');
            o.dataset.demoRing = '1';
            o.style.cssText = [
                'position:absolute',
                `left:${r.x - 6}px`,
                `top:${r.y - 6}px`,
                `width:${r.width + 12}px`,
                `height:${r.height + 12}px`,
                `border:3px solid ${color}`,
                'border-radius:10px',
                `box-shadow:0 0 0 5px ${color}33`,
            ].join(';');
            group.appendChild(o);
        }
        requestAnimationFrame(() => (group.style.opacity = '1'));
        if (pop) {
            // motion.pop: the bubble bounces in, the ring keeps pulsing
            bubble.animate([{ transform: 'scale(.55)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)' }], {
                duration: 460,
                easing: 'cubic-bezier(.2,.8,.2,1)',
            });
            group.querySelector('[data-demo-ring]')?.animate([{ boxShadow: `0 0 0 0 ${color}88` }, { boxShadow: `0 0 0 16px ${color}00` }], {
                duration: 1100,
                iterations: Infinity,
            });
        }
    }, { id: CALLOUTS_ID, hudId: HUD_ID, r: box, text, color: calloutCfg.color, ring, replace, gid, look: calloutCfg, pop: !!motionCfg.pop })
        .catch(() => { });
    void followTarget(page, target, box, gid);
    await wait(page, holdMs);
    if (!keep)
        await clearCallouts(page);
}
/** Keep callout group `gid` glued to `target` while it's on screen: re-resolve the locator every
 *  100ms and translate ring + arrow + bubble by how far the target moved. Re-resolving (not tracking
 *  the element in-page) matters: a terminal's rows are fixed divs whose TEXT scrolls through them, so
 *  "the row with X" becomes another element. Ends by itself once the group is gone (clearCallouts,
 *  `replace`, zoomOut, navigation). ponytail: follows moves, not resizes — redraw if that's needed. */
async function followTarget(page, target, from, gid) {
    let last = '';
    while (!page.isClosed()) {
        await new Promise((r) => setTimeout(r, 100));
        const b = await target.boundingBox({ timeout: 500 }).catch(() => null);
        const shift = b ? `translate(${b.x - from.x}px,${b.y - from.y}px)` : last; // target gone for a moment → stay put
        const alive = await page
            .evaluate(({ gid, shift }) => {
            const g = document.querySelector(`[data-demo-group="${gid}"]`);
            if (g && shift)
                g.style.transform = shift;
            return !!g;
        }, { gid, shift: shift === last ? '' : shift })
            .catch(() => false);
        if (!alive)
            return;
        last = shift;
    }
}
/** Remove all callouts. */
async function clearCallouts(page) {
    await page.evaluate((id) => document.getElementById(id)?.remove(), CALLOUTS_ID).catch(() => { });
}
/** Set a caption, then hold so the viewer can read it before the action runs. */
/** Set a caption and pause the action for `holdMs`. The caption itself stays up at least its
 *  reading time (readMs) regardless — the next action may already start while it's being read. */
async function narrate(page, text, holdMs, opts = {}) {
    await hud(page, text, opts);
    await wait(page, holdMs ?? Number(hudCfg.hold ?? 1200));
}
/** Move the mouse along a curved, eased path (human-like) from its current spot to (x, y). */
async function humanMove(page, x, y) {
    const fromX = mouse.x;
    const fromY = mouse.y;
    const dist = Math.hypot(x - fromX, y - fromY);
    if (dist < 2 || pace() === 0) {
        if (dist >= 2)
            await page.mouse.move(x, y);
        mouse = { x, y };
        return;
    }
    const k = Number(motionCfg.cursor) || 1;
    const steps = Math.round(k * Math.max(14, Math.min(46, Math.round(dist / 16))));
    const bow = k * Math.min(60, dist * 0.14); // perpendicular arc so the path isn't a straight line
    const nx = -(y - fromY) / dist;
    const ny = (x - fromX) / dist;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
        const arc = Math.sin(t * Math.PI) * bow;
        await page.mouse.move(fromX + (x - fromX) * ease + nx * arc, fromY + (y - fromY) * ease + ny * arc);
        await wait(page, 9);
    }
    mouse = { x, y };
    await wait(page, 200 * k);
}
/** Scroll `locator` into view AND out from under any position:fixed/sticky bar — Playwright's
 *  scrollIntoViewIfNeeded counts an element hidden behind a sticky header as visible. Does nothing
 *  extra when the target is already unobscured (no jitter), or while zoomed (scrolling would wreck it). */
async function reveal(page, locator) {
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
    await wait(page, 280); // let smooth-scroll settle before reading coordinates
    const scrolled = await locator
        .evaluate((el, own) => {
        if (document.body.style.transform || document.querySelector('[data-demo-zoom-root]')?.style.transform)
            return false;
        const r = el.getBoundingClientRect();
        const covered = [0.25, 0.5, 0.75].some((f) => {
            const x = r.left + r.width * f;
            const y = r.top + r.height / 2;
            const hit = document.elementsFromPoint(x, y).find((e) => !own.some((id) => e.closest('#' + id)));
            if (!hit || hit === document.documentElement || hit === document.body)
                return false;
            if (el.contains(hit))
                return false;
            for (let n = el; n; n = n.parentNode || n.host)
                if (n === hit)
                    return false;
            return true;
        });
        if (covered)
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        return covered;
    }, [HUD_ID, CURSOR_ID, CALLOUTS_ID])
        .catch(() => false);
    if (scrolled)
        await wait(page, 280);
}
/** Glide the cursor to a locator's center. Scrolls the target into view FIRST so the page settles
 *  before the glide — otherwise the click's own auto-scroll jerks the view mid-action. */
async function moveTo(page, locator) {
    await reveal(page, locator);
    const box = await locator.boundingBox().catch(() => null);
    if (!box)
        return;
    await humanMove(page, box.x + box.width / 2, box.y + box.height / 2);
}
/** Move the cursor to a neutral resting spot (e.g. off a button while its action runs). */
async function parkCursor(page, x, y) {
    const vp = page.viewportSize() ?? { width: 1680, height: 1050 };
    await humanMove(page, x ?? Math.round(vp.width * 0.62), y ?? Math.round(vp.height * 0.3));
}
/** Safety net: any `click`/`tap` on an element whose text / aria-label / title matches one of
 *  these throws instead of clicking — so a mis-aimed locator can't hit "Save", "Delete",
 *  "Publish", "Apply" on real data. Adds to project.json's `forbid`. Strings: "/re/i" or text. */
function forbid(patterns) {
    forbidden.push(...patterns.map(toPattern));
}
/** Error UI to watch during waits (`fastForward` / `actAndWait`): the moment one is visible the
 *  take fails with its text — instead of burning the whole timeout on an answer that will never
 *  come (rate limits, 500s, "something went wrong" toasts). Call once at the top of the spec. */
function failOn(...locators) {
    failWatch.push(...locators);
}
async function watchFailures(page, done) {
    while (!done()) {
        for (const l of failWatch) {
            const el = l.first();
            if (await el.isVisible().catch(() => false)) {
                const text = ((await el.innerText().catch(() => '')) || '').trim().slice(0, 300);
                throw new Error(`demo.failOn: error UI appeared — ${text || l.toString()}`);
            }
        }
        await page.waitForTimeout(500).catch(() => { }); // a real poll interval, dry run or not
    }
    return new Promise(() => { });
}
async function assertAllowed(locator) {
    if (!forbidden.length)
        return;
    const label = await locator
        .first()
        .evaluate((el) => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')].join(' '))
        .catch(() => '');
    const hit = forbidden.find((re) => re.test(label));
    if (hit)
        throw new Error(`demo.forbid: refusing to click "${label.trim().slice(0, 60)}" (matches ${hit})`);
}
/** Glide to a locator, then real-click it (keeps the fake-cursor tracking consistent). */
async function click(page, locator) {
    await assertAllowed(locator);
    await moveTo(page, locator);
    await locator.click();
    await wait(page, 250);
}
/** Glide, then dispatch a click straight to the handler — for elements that animate or reflow so
 *  Playwright's real click never reaches "stable" (framer-motion items, ⋯ menus, close ×). */
async function tap(page, locator) {
    await assertAllowed(locator);
    await moveTo(page, locator);
    await locator.dispatchEvent('click');
    await wait(page, 250);
}
/** Glide to a field, select existing text, then type visibly one char at a time — new text
 *  REPLACES the default instead of appending to it. Long text types faster so typing never takes
 *  more than ~3.5s of video (a 150-char prompt at 95ms/char would be 14s of dead air). */
async function slowType(page, field, text, delayMs = 95) {
    const cap = Number(motionCfg.typeCapMs ?? 3500);
    if (cap > 0)
        delayMs = Math.min(delayMs, Math.max(20, cap / Math.max(1, text.length)));
    await moveTo(page, field);
    await field.click();
    await field.press('ControlOrMeta+a');
    await wait(page, 150);
    if (pace() === 0)
        await field.fill(text);
    else
        await field.pressSequentially(text, { delay: Math.round(delayMs * pace()) });
    await wait(page, 500);
}
/** Click a control only some paths show (a confirm a single-select picker skips, a "what's new"
 *  toast). Visible-then-click is a race — the control can close between the check and the click — so
 *  one that is gone by the click counts as "not shown", never as a failure. Same as a manifest step
 *  with `"optional": true`, for specs. */
async function clickIfShown(page, locator, appearMs = 1500) {
    if (!(await locator.isVisible({ timeout: appearMs }).catch(() => false)))
        return false;
    await assertAllowed(locator);
    await moveTo(page, locator);
    const clicked = await locator.click({ timeout: 1500 }).then(() => true, async (error) => {
        if (await locator.isVisible().catch(() => false))
            throw error;
        return false;
    });
    await wait(page, 250);
    return clicked;
}
/** Save a clean still for the PR/ticket/Slack post: no cursor, no caption. Whole viewport, or —
 *  with `target` — just that component plus `pad` px of context, optionally ringed so the eye lands
 *  on it. Take one at each beat that IS the feature (after `withZoom`, not inside it — the zoom
 *  transform would be in the shot). Files land next to the mp4 as `<stem>-shots/NN-<name>.png`.
 *  The moment overlays are hidden is cut from the video, so it doesn't flicker. */
async function shot(page, name, opts = {}) {
    const dir = process.env.DEMO_SHOTS_DIR;
    if (!dir)
        return;
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    const { target, pad = 24, highlight = !!target, fullPage = false } = opts;
    const file = (0, node_path_1.join)(dir, `${String(++shotCount).padStart(2, '0')}-${name.replace(/[^\w-]+/g, '-')}.png`);
    const start = (Date.now() - t0) / 1000;
    // The raw video's clock runs a frame or two behind Date.now() - t0, so whatever changes right at
    // `start` (ring on, cursor hidden) lands just BEFORE the cut and flashes for a frame. Change nothing
    // until well inside it; the wait is cut too.
    await wait(page, 200);
    const toggle = (hide) => page
        .evaluate(({ ids, hide }) => ids.forEach((id) => document.getElementById(id)?.style.setProperty('visibility', hide ? 'hidden' : '')), { ids: [HUD_ID, CURSOR_ID, ...(calloutCfg.inShots ? [] : [CALLOUTS_ID])], hide })
        .catch(() => { });
    const ring = target ? await target.evaluate((el, on) => {
        if (!on)
            return '';
        const prev = el.style.outline;
        el.style.outline = '3px solid #f43f5e';
        el.style.outlineOffset = '4px';
        return prev;
    }, highlight).catch(() => '') : '';
    await toggle(true);
    try {
        if (target)
            await reveal(page, target);
        let box = target ? await target.boundingBox().catch(() => null) : null;
        const vp = page.viewportSize();
        if (box && calloutCfg.inShots) {
            // grow the crop to include any callout bubbles so the label isn't cut off
            const bubbles = await page
                .evaluate(() => [...document.querySelectorAll('[data-demo-bubble]')].map((b) => b.getBoundingClientRect().toJSON()))
                .catch(() => []);
            for (const b of bubbles) {
                const x = Math.min(box.x, b.x);
                const y = Math.min(box.y, b.y);
                box = { x, y, width: Math.max(box.x + box.width, b.right) - x, height: Math.max(box.y + box.height, b.bottom) - y };
            }
        }
        if (box && vp) {
            const x = Math.max(0, box.x - pad);
            const y = Math.max(0, box.y - pad);
            const clip = { x, y, width: Math.min(vp.width - x, box.width + pad * 2), height: Math.min(vp.height - y, box.height + pad * 2) };
            await page.screenshot({ path: file, clip });
        }
        else {
            await page.screenshot({ path: file, fullPage });
        }
    }
    finally {
        await toggle(false);
        if (target && highlight)
            await target.evaluate((el, prev) => (el.style.outline = prev), ring).catch(() => { });
        // Playwright's screencast keeps re-sending the screenshot frame (a clipped one shows as a grey
        // slab) until the page paints again — a static page never does. Repaint a speck every frame
        // for 1.2s, then cut that window too.
        await page
            .evaluate(() => new Promise((done) => {
            const d = document.createElement('div');
            d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;z-index:2147483647';
            document.documentElement.appendChild(d);
            const end = performance.now() + 1200;
            let n = 0;
            const tick = () => {
                d.style.background = `rgba(128,128,128,${n++ % 2 ? 0.02 : 0.03})`;
                if (performance.now() < end)
                    requestAnimationFrame(tick);
                else
                    d.remove(), done();
            };
            tick();
        }))
            .catch(() => page.waitForTimeout(1200));
        cutSince(start, name); // cut from the video
    }
    console.log(`[shot] ${file}`);
    return file;
}
/** In-spec probe: dump the ARIA tree + a screenshot of the CURRENT state (dialog open, form
 *  filled, proposal shown…) — states `record-demo.sh probe <url>` can't reach. Use while
 *  writing a spec, then delete the call. Prints where it wrote. */
async function snapshot(page, label) {
    const dir = process.env.DEMO_PROBE_DIR;
    if (!dir)
        return;
    (0, node_fs_1.mkdirSync)(dir, { recursive: true });
    const base = (0, node_path_1.join)(dir, label.replace(/[^\w-]+/g, '-'));
    (0, node_fs_1.writeFileSync)(`${base}.txt`, `URL: ${page.url()}\n\n${await page.locator('body').ariaSnapshot().catch((e) => String(e))}`);
    await page.screenshot({ path: `${base}.png` }).catch(() => { });
    console.log(`[snapshot] ${base}.txt + .png`);
}
/** Run `fn` (a wait: LLM answer, job, upload) and mark its span so the final video plays it
 *  `factor`× faster — the viewer sees the spinner zip by instead of 40s of dead air. The caption
 *  gets a ⏩ while it runs so the speed-up is honest. factor ≤ 1 = no-op. */
async function fastForward(page, fn, factor = 8) {
    if (factor <= 1 && !failWatch.length)
        return fn();
    if (factor > 1)
        await letCaptionBeRead(page); // read it at normal speed before the ⏩ part
    const caption = factor > 1 ? lastCaption : '';
    if (caption)
        await paint(page, `${caption}  ⏩`);
    const start = (Date.now() - t0) / 1000;
    let done = false;
    try {
        return await (failWatch.length ? Promise.race([fn(), watchFailures(page, () => done)]) : fn());
    }
    finally {
        done = true;
        segments.push({ start, end: (Date.now() - t0) / 1000, factor });
        if (caption)
            await paint(page, caption);
    }
}
/** Click a trigger (e.g. Submit / Generate / Run), park the cursor off it, wait until the app's own
 *  "busy" indicator (spinner, skeleton, `aria-busy`) appears and then clears, then hold the result
 *  on camera. Waiting on the DOM is synced to what the camera shows — no guessed sleeps. Never aborts
 *  the recording if it lags. Without `busy`, waits for network idle instead. The wait is
 *  fast-forwarded `fastForward`× in the final video (default 8; 1 = real time). */
async function actAndWait(page, trigger, caption, opts = {}) {
    const { busy, holdMs = 1200, timeoutMs = 180_000, fastForward: ff = 8 } = opts;
    await (0, test_1.expect)(trigger).toBeEnabled({ timeout: 15_000 });
    await hud(page, `${caption} — working…`);
    await moveTo(page, trigger);
    const startedAt = Date.now();
    await trigger.click();
    await parkCursor(page);
    let timedOut = false;
    await fastForward(page, async () => {
        if (!busy) {
            await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => (timedOut = true));
            return;
        }
        // Confirm it started before waiting for it to finish — a poll before the spinner mounts reads
        // a false "already done" zero. A very fast action may finish before we ever see it; fine.
        await test_1.expect
            .poll(() => busy.count(), { timeout: 15_000, intervals: [300, 500, 1000] })
            .toBeGreaterThan(0)
            .catch(() => { });
        await test_1.expect
            .poll(() => busy.count(), { timeout: timeoutMs, intervals: [500, 1000, 2000] })
            .toBe(0)
            .catch(() => (timedOut = true));
    }, ff);
    console.log(`[actAndWait] ${caption} — ${((Date.now() - startedAt) / 1000).toFixed(1)}s${timedOut ? ' (timed out)' : ''}`);
    await hud(page, `${caption} — done ✓`);
    await wait(page, holdMs); // let the result's fade-in finish
}
// ── Camera zoom (for pivotal moments) ───────────────────────────────────────
//
// Scales `document.body` (NOT `documentElement`) around a viewport point, with `documentElement`
// clipping the overflow — a real CSS transform, so Playwright's coordinate math (re-read at click
// time) stays correct: click/tap/slowType keep working while zoomed. The cursor/HUD live on
// `documentElement`, so the zoom never magnifies the recording chrome.
//
// ⚠️ Apps whose root is `position:fixed`/`100vh` and portals rendered to <body> still work; apps that
// put their root directly on <html> won't zoom — then skip zoom.
/** Zoom the camera in on a viewport point. Pair with `zoomOut`; prefer `withZoom`. */
async function zoomToPoint(page, x, y, scale = 1.7 * (Number(motionCfg.zoom) || 1)) {
    await page
        .evaluate(({ x, y, scale }) => {
        // Zoom root: a fixed layer marked by withZoom (side panel, drawer) or <body>. Scaling body
        // would re-anchor fixed descendants to it and throw them off-screen on a scrolled page.
        const root = document.querySelector('[data-demo-zoom-root]') ?? document.body;
        if (root === document.body)
            document.documentElement.style.overflow = 'hidden';
        const r = root.getBoundingClientRect(); // origin is in the root's own box, not the viewport
        root.style.transition = 'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        root.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
        root.style.transform = `scale(${scale})`;
        if (root !== document.body)
            root.style.zIndex = '2147483000';
    }, { x, y, scale })
        .catch(() => { });
    await wait(page, 460);
}
/** Reverse `zoomToPoint`. */
async function zoomOut(page) {
    await clearCallouts(page); // drawn in zoomed coordinates — stale once we zoom out
    await page
        .evaluate(() => {
        (document.querySelector('[data-demo-zoom-root]') ?? document.body).style.transform = '';
    })
        .catch(() => { });
    await wait(page, 460);
    await page
        .evaluate(() => {
        const el = document.querySelector('[data-demo-zoom-root]') ?? document.body;
        el.style.transition = '';
        el.style.transformOrigin = '';
        el.style.zIndex = '';
        el.removeAttribute('data-demo-zoom-root');
        document.documentElement.style.overflow = '';
    })
        .catch(() => { });
}
/** Wait until `target`'s box stops moving (async content still landing reflows it). */
async function stableBox(page, target, timeoutMs = 3000) {
    let prev = await target.boundingBox().catch(() => null);
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        await wait(page, 250);
        const cur = await target.boundingBox().catch(() => null);
        const same = cur && prev && ['x', 'y', 'width', 'height'].every((k) => Math.abs(cur[k] - prev[k]) < 1);
        if (same)
            return cur;
        prev = cur;
    }
    return prev;
}
/** Glide to `target`, zoom in on it, run `action`, hold, zoom out. Use SPARINGLY — only the 2–4
 *  moments that ARE the feature being shown, or the effect stops meaning anything.
 *  - waits for the target to stop reflowing first (zooming mid-reflow crops it);
 *  - scale shrinks + origin shifts so the whole target stays on screen (wide cards don't crop);
 *  - skipped (action runs at normal scale) when a dialog is open — scaling <body> breaks fixed
 *    backdrops — or the target has no box / is already too big to magnify;
 *  - a target inside a position:fixed layer (side panel, drawer) zooms THAT layer, not <body>. */
async function withZoom(page, target, action, opts = {}) {
    const { holdMs = 500, margin = 24 } = opts;
    const scale = (opts.scale ?? 1.7) * (Number(motionCfg.zoom) || 1); // motion.zoom (audience) scales any step's own scale too
    await moveTo(page, target);
    const box = await stableBox(page, target);
    const vp = page.viewportSize();
    const dialogOpen = (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count().catch(() => 0)) > 0;
    // A transformed <body> re-anchors position:fixed descendants to the body box, so a fixed side
    // panel would jump off-screen. Target inside a fixed layer → zoom that layer instead.
    await target
        .evaluate((el) => {
        let fixed = null;
        for (let e = el; e && e !== document.body; e = e.parentElement)
            if (getComputedStyle(e).position === 'fixed')
                fixed = e;
        fixed?.setAttribute('data-demo-zoom-root', '');
    })
        .catch(() => { });
    const s = box && vp ? Math.min(scale, (vp.width - 2 * margin) / box.width, (vp.height - 2 * margin) / box.height) : 1;
    if (!box || !vp || dialogOpen || s < 1.08) {
        await page.evaluate(() => document.querySelector('[data-demo-zoom-root]')?.removeAttribute('data-demo-zoom-root')).catch(() => { });
        return action();
    }
    // origin o keeps [lo, hi] on screen after scaling: m ≤ s·lo − (s−1)·o and s·hi − (s−1)·o ≤ v − m
    const fit = (lo, hi, v) => Math.min(Math.max((lo + hi) / 2, (s * hi - v + margin) / (s - 1)), (s * lo - margin) / (s - 1));
    await zoomToPoint(page, fit(box.x, box.x + box.width, vp.width), fit(box.y, box.y + box.height, vp.height), s);
    try {
        await action();
    }
    finally {
        await wait(page, holdMs);
        await zoomOut(page);
    }
}
exports.demo = {
    DRY_RUN: exports.DRY_RUN,
    begin,
    saveTimeline,
    resetCursor,
    installCursor,
    startRecording,
    fakeLocalStorage,
    hud,
    narrate,
    humanMove,
    moveTo,
    parkCursor,
    click,
    clickIfShown,
    tap,
    slowType,
    actAndWait,
    fastForward,
    readMs,
    /** Wait until the caption on screen has been read (and spoken) — e.g. before playing media whose sound must not overlap it. */
    waitForCaption: letCaptionBeRead,
    spoken,
    shot,
    snapshot,
    forbid,
    failOn,
    loc,
    re,
    callout,
    clearCallouts,
    configure,
    zoomToPoint,
    zoomOut,
    withZoom,
};
