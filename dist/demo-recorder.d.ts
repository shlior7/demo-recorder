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
import { expect, type Locator, type Page } from '@playwright/test';
export { expect };
type Json = any;
/** "/re/i" → RegExp; anything else unchanged. */
export declare function re(v: Json): Json;
/** One locator language for specs, manifests and project.json:
 *  "Button text" | { role, name, exact } | { testId } | { text } | { label } | { placeholder } |
 *  { css } — plus optional "in": LOC (scope), "nth": n, "first": true. "/re/i" strings are regexes. */
export declare function loc(page: Page, l: Json): Locator;
/** Start a take's timeline: call right after the page (and so its video) is created. The `test`
 *  fixture does this for you; a repo driving its own Playwright fixtures calls it itself, then
 *  `saveTimeline(dir)` at the end and `record-demo.sh finish <dir>` for the caption bar, fast-forward
 *  and mp4 — or keeps the default in-page captions and needs neither. */
export declare function begin(): void;
/** Write the take's timeline for post-production: `captions.json` (+ the look), `segments.json`
 *  (fast-forwards and cuts), `steps.json` (one verify-frame per caption/callout). Pass a directory
 *  (the one holding the take's .webm, for `record-demo.sh finish <dir>`) or explicit file paths. */
export declare function saveTimeline(to: string | {
    captions?: string;
    segments?: string;
    steps?: string;
}): void;
/** Playwright `test`, plus fast-forward bookkeeping and project defaults. Use this one, not
 *  '@playwright/test'. */
export declare const test: any;
type HudConfig = {
    position: 'top' | 'bottom' | 'overlay' | 'off';
    size: 'sm' | 'md' | 'lg';
    theme: 'dark' | 'light';
    wpm: number;
    minMs: number;
    readingTime: boolean;
    hold: number;
    background?: string | null;
    color?: string | null;
    accent?: string | null;
    font?: string | null;
    weight?: number | string;
    border?: number | string | null;
    css?: string;
};
type CalloutConfig = {
    color: string;
    ring: boolean;
    inShots: boolean;
    textColor?: string;
    font?: string | null;
    css?: string;
};
type MotionConfig = {
    zoom: number;
    cursor: number;
    pop: boolean;
    pace: number;
    typeCapMs: number;
};
/** Per-spec override of the persisted look, e.g. `demo.configure({ hud: { position: 'bottom' } })`. */
export declare function configure(o: {
    hud?: Partial<HudConfig>;
    callout?: Partial<CalloutConfig>;
    motion?: Partial<MotionConfig>;
}): void;
export declare const DRY_RUN: boolean;
/** How long `text` must be visible to be read: base + words at hud.wpm, clamped to [minMs, 7s],
 *  scaled by --speed (a 1.5× video needs 1.5× the real time). */
export declare function readMs(text: string): number;
/** Wait until the current caption has had its reading time. */
declare function letCaptionBeRead(page: Page): Promise<void>;
/** One line's voice, over the voice.* settings: any of them, `say` to speak other words than the caption
 *  shows (punctuation for delivery: "Change a setting. Rerun. That's it!"), or false for a silent line. */
export type LineVoice = false | {
    say?: string;
    energy?: 'calm' | 'warm' | 'upbeat' | 'rainbow';
    exaggeration?: number;
    cfg?: number;
    temperature?: number;
    ref?: string;
};
/** Caption → what the voice should say: symbols read out or dropped. */
export declare function spoken(text: string): string;
/** Reset the cursor tracker. Call at the top of every spec. */
export declare function resetCursor(x?: number, y?: number): void;
/** Inject a macOS-style arrow cursor that follows real mouse movements. Idempotent. Appended to
 *  `<html>`, not `<body>` (React/Next/Vue roots reconcile body children away), and must run AFTER
 *  hydration (pre-hydration injection can trigger a hydration mismatch). Re-call after a full
 *  navigation — it no-ops if the cursor already exists. */
export declare function installCursor(page: Page): Promise<void>;
/** After goto: settle + hydrate, then install the cursor. The canonical opener for a recorded flow. */
export declare function startRecording(page: Page, hydrateMs?: number): Promise<void>;
/** Make the app believe one-time UI (onboarding tours, "what's new" callouts, cookie banners) was
 *  already seen, so it can never pop up mid-recording and swallow a click. Patches
 *  `localStorage.getItem` — every key starting with a map key returns that value. Waiting for the
 *  popup and clicking "Okay" races its own mount timing; this doesn't. Call ONCE before the first
 *  `page.goto` (addInitScript re-applies on every navigation). Find the keys in the app's source or
 *  DevTools → Application → Local Storage after dismissing the popup manually. */
export declare function fakeLocalStorage(page: Page, values: Record<string, string>): Promise<void>;
/** Show a caption — the step title in the bar above the page (or on the page with
 *  `hud.position: overlay`). Each call is a "step": logged with the previous step's duration, and
 *  record-demo.sh saves one verify-frame per step. With --voice the caption is also read aloud and
 *  stays up until its clip has played. */
export declare function hud(page: Page, text: string, opts?: {
    voice?: LineVoice;
}): Promise<void>;
/** A LOCAL label pointing at the change: bubble placed on the free side of `target` (right, left,
 *  below, above — whichever covers least important UI and stays on screen), an arrow to it, and a
 *  ring around it. Pairs with the global caption: caption = what's happening, callout = look HERE.
 *  Holds `holdMs`, then clears (`keep: true` leaves it until `clearCallouts` / zoomOut / next
 *  `callout` with `replace`). Inside `withZoom`, call it in the action — it's drawn in zoomed
 *  coordinates. Shown in `shot()` stills unless `callout.inShots` is false. While shown it follows
 *  `target` when the page scrolls or reflows (output arriving, async lists) — see followTarget. */
export declare function callout(page: Page, target: Locator, text: string, opts?: {
    holdMs?: number;
    keep?: boolean;
    ring?: boolean;
    replace?: boolean;
}): Promise<void>;
/** Remove all callouts. */
export declare function clearCallouts(page: Page): Promise<void>;
/** Set a caption, then hold so the viewer can read it before the action runs. */
/** Set a caption and pause the action for `holdMs`. The caption itself stays up at least its
 *  reading time (readMs) regardless — the next action may already start while it's being read. */
export declare function narrate(page: Page, text: string, holdMs?: number, opts?: {
    voice?: LineVoice;
}): Promise<void>;
/** Move the mouse along a curved, eased path (human-like) from its current spot to (x, y). */
export declare function humanMove(page: Page, x: number, y: number): Promise<void>;
/** Glide the cursor to a locator's center. Scrolls the target into view FIRST so the page settles
 *  before the glide — otherwise the click's own auto-scroll jerks the view mid-action. */
export declare function moveTo(page: Page, locator: Locator): Promise<void>;
/** Move the cursor to a neutral resting spot (e.g. off a button while its action runs). */
export declare function parkCursor(page: Page, x?: number, y?: number): Promise<void>;
/** Safety net: any `click`/`tap` on an element whose text / aria-label / title matches one of
 *  these throws instead of clicking — so a mis-aimed locator can't hit "Save", "Delete",
 *  "Publish", "Apply" on real data. Adds to project.json's `forbid`. Strings: "/re/i" or text. */
export declare function forbid(patterns: (RegExp | string)[]): void;
/** Error UI to watch during waits (`fastForward` / `actAndWait`): the moment one is visible the
 *  take fails with its text — instead of burning the whole timeout on an answer that will never
 *  come (rate limits, 500s, "something went wrong" toasts). Call once at the top of the spec. */
export declare function failOn(...locators: Locator[]): void;
/** Glide to a locator, then real-click it (keeps the fake-cursor tracking consistent). */
export declare function click(page: Page, locator: Locator): Promise<void>;
/** Glide, then dispatch a click straight to the handler — for elements that animate or reflow so
 *  Playwright's real click never reaches "stable" (framer-motion items, ⋯ menus, close ×). */
export declare function tap(page: Page, locator: Locator): Promise<void>;
/** Glide to a field, select existing text, then type visibly one char at a time — new text
 *  REPLACES the default instead of appending to it. Long text types faster so typing never takes
 *  more than ~3.5s of video (a 150-char prompt at 95ms/char would be 14s of dead air). */
export declare function slowType(page: Page, field: Locator, text: string, delayMs?: number): Promise<void>;
/** Click a control only some paths show (a confirm a single-select picker skips, a "what's new"
 *  toast). Visible-then-click is a race — the control can close between the check and the click — so
 *  one that is gone by the click counts as "not shown", never as a failure. Same as a manifest step
 *  with `"optional": true`, for specs. */
export declare function clickIfShown(page: Page, locator: Locator, appearMs?: number): Promise<boolean>;
/** Save a clean still for the PR/ticket/Slack post: no cursor, no caption. Whole viewport, or —
 *  with `target` — just that component plus `pad` px of context, optionally ringed so the eye lands
 *  on it. Take one at each beat that IS the feature (after `withZoom`, not inside it — the zoom
 *  transform would be in the shot). Files land next to the mp4 as `<stem>-shots/NN-<name>.png`.
 *  The moment overlays are hidden is cut from the video, so it doesn't flicker. */
export declare function shot(page: Page, name: string, opts?: {
    target?: Locator;
    pad?: number;
    highlight?: boolean;
    fullPage?: boolean;
}): Promise<string | undefined>;
/** In-spec probe: dump the ARIA tree + a screenshot of the CURRENT state (dialog open, form
 *  filled, proposal shown…) — states `record-demo.sh probe <url>` can't reach. Use while
 *  writing a spec, then delete the call. Prints where it wrote. */
export declare function snapshot(page: Page, label: string): Promise<void>;
/** Run `fn` (a wait: LLM answer, job, upload) and mark its span so the final video plays it
 *  `factor`× faster — the viewer sees the spinner zip by instead of 40s of dead air. The caption
 *  gets a ⏩ while it runs so the speed-up is honest. factor ≤ 1 = no-op. */
export declare function fastForward<T>(page: Page, fn: () => Promise<T>, factor?: number): Promise<T>;
/** Click a trigger (e.g. Submit / Generate / Run), park the cursor off it, wait until the app's own
 *  "busy" indicator (spinner, skeleton, `aria-busy`) appears and then clears, then hold the result
 *  on camera. Waiting on the DOM is synced to what the camera shows — no guessed sleeps. Never aborts
 *  the recording if it lags. Without `busy`, waits for network idle instead. The wait is
 *  fast-forwarded `fastForward`× in the final video (default 8; 1 = real time). */
export declare function actAndWait(page: Page, trigger: Locator, caption: string, opts?: {
    busy?: Locator;
    holdMs?: number;
    timeoutMs?: number;
    fastForward?: number;
}): Promise<void>;
/** Zoom the camera in on a viewport point. Pair with `zoomOut`; prefer `withZoom`. */
export declare function zoomToPoint(page: Page, x: number, y: number, scale?: number): Promise<void>;
/** Reverse `zoomToPoint`. */
export declare function zoomOut(page: Page): Promise<void>;
/** Glide to `target`, zoom in on it, run `action`, hold, zoom out. Use SPARINGLY — only the 2–4
 *  moments that ARE the feature being shown, or the effect stops meaning anything.
 *  - waits for the target to stop reflowing first (zooming mid-reflow crops it);
 *  - scale shrinks + origin shifts so the whole target stays on screen (wide cards don't crop);
 *  - skipped (action runs at normal scale) when a dialog is open — scaling <body> breaks fixed
 *    backdrops — or the target has no box / is already too big to magnify;
 *  - a target inside a position:fixed layer (side panel, drawer) zooms THAT layer, not <body>. */
export declare function withZoom(page: Page, target: Locator, action: () => Promise<void>, opts?: {
    scale?: number;
    holdMs?: number;
    margin?: number;
}): Promise<void>;
export declare const demo: {
    DRY_RUN: boolean;
    begin: typeof begin;
    saveTimeline: typeof saveTimeline;
    resetCursor: typeof resetCursor;
    installCursor: typeof installCursor;
    startRecording: typeof startRecording;
    fakeLocalStorage: typeof fakeLocalStorage;
    hud: typeof hud;
    narrate: typeof narrate;
    humanMove: typeof humanMove;
    moveTo: typeof moveTo;
    parkCursor: typeof parkCursor;
    click: typeof click;
    clickIfShown: typeof clickIfShown;
    tap: typeof tap;
    slowType: typeof slowType;
    actAndWait: typeof actAndWait;
    fastForward: typeof fastForward;
    readMs: typeof readMs;
    /** Wait until the caption on screen has been read (and spoken) — e.g. before playing media whose sound must not overlap it. */
    waitForCaption: typeof letCaptionBeRead;
    spoken: typeof spoken;
    shot: typeof shot;
    snapshot: typeof snapshot;
    forbid: typeof forbid;
    failOn: typeof failOn;
    loc: typeof loc;
    re: typeof re;
    callout: typeof callout;
    clearCallouts: typeof clearCallouts;
    configure: typeof configure;
    zoomToPoint: typeof zoomToPoint;
    zoomOut: typeof zoomOut;
    withZoom: typeof withZoom;
};
