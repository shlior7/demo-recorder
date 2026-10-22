// `record-demo.sh present <take.mp4>` — re-cut a finished take as a presentation with HyperFrames
// (https://github.com/heygen-com/hyperframes): a title card, then per chapter a heading slide and the
// recording framed as a browser window (caption bar cropped off) with its callouts as outcome badges,
// a highlights slide, an end card. The take's own voice plays under its footage, in sync.
//
//   node present.mjs <take.mp4> <project-dir> [config-json]
//
// Writes a plain HyperFrames project (index.html + assets/) and prints its length. record-demo.sh then
// runs `hyperframes check` and `render`. To polish it further, open the project with the /hyperframes skills.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [take, dir, cfgArg] = process.argv.slice(2);
const stem = take.replace(/\.mp4$/, '');
const FFMPEG = process.env.FFMPEG || 'ffmpeg', FFPROBE = process.env.FFPROBE || 'ffprobe';
const probe = (f, ...a) => execFileSync(FFPROBE, ['-v', 'error', ...a, '-of', 'csv=p=0', f]).toString().trim();
const cfg = JSON.parse(cfgArg || '{}');
const chapters = JSON.parse(readFileSync(`${stem}-chapters.json`, 'utf8'));

const dur = Number(probe(take, '-show_entries', 'format=duration'));
const [W, H] = probe(take, '-select_streams', 'v:0', '-show_entries', 'stream=width,height').split(',').map(Number);
const voiced = probe(take, '-select_streams', 'a', '-show_entries', 'stream=codec_name') !== '';
// the caption bar: recorded in the chapters since 0.7; older takes → the mp4 is taller than the raw .webm by it
const frame = chapters.find((c) => c.kind === 'frame');
const rawH = existsSync(`${stem}.webm`) ? Number(probe(`${stem}.webm`, '-select_streams', 'v:0', '-show_entries', 'stream=height')) : H;
const BAR = frame?.bar ?? Math.max(0, H - rawH), BAR_AT = frame?.at ?? 'top';

const caps = chapters.filter((c) => c.kind === 'caption' && c.text.trim());
const callouts = chapters.filter((c) => c.kind === 'callout' && c.text.trim());
if (!caps.length) throw new Error(`${stem}-chapters.json has no captions — nothing to build slides from`);
const accent = cfg.hud?.accent ?? cfg.callout?.color ?? '#f43f5e';

// ── scenes: [kind, data, seconds]; each one slides in over the last (O s of overlap) ──
const O = 0.6, HEAD = 2.2;
const span = (i) => [caps[i].t, i + 1 < caps.length ? caps[i + 1].t : dur]; // a caption's stretch of the take
const [kicker, ...rest] = caps[0].text.split(' · ');
const scenes = [];
const title = rest.length ? { title: kicker, sub: rest.join(' · ') } : { title: caps[0].text, sub: '' };
const body = caps.length > 2 ? caps.slice(1, -1) : caps.slice(1);
const end = caps.length > 2 ? caps.at(-1) : null;
// title card: the first caption, with its voice line (the take's first stretch)
scenes.push({ kind: 'title', ...title, audio: span(0), len: Math.max(3.2, span(0)[1] - span(0)[0] + O) });
body.forEach((c, k) => {
  const i = caps.indexOf(c), [a, b] = span(i), n = `${String(k + 1).padStart(2, '0')} / ${String(body.length).padStart(2, '0')}`;
  scenes.push({ kind: 'heading', n, text: c.text, len: HEAD });
  const badges = callouts.filter((x) => x.t >= a && x.t < b).map((x) => ({ text: x.text, at: x.t - a }));
  scenes.push({ kind: 'footage', n, text: c.text, media: [a, b], badges, len: b - a + O });
});
if (callouts.length >= 2) scenes.push({ kind: 'highlights', items: callouts.map((x) => x.text), len: 1.6 + 0.45 * callouts.length + 1.6 });
if (end) scenes.push({ kind: 'end', text: end.text, sub: title.title, audio: span(caps.indexOf(end)), len: Math.max(3, span(caps.indexOf(end))[1] - end.t + O) });
let t = 0;
for (const s of scenes) { s.start = Math.max(0, t - O); t = s.start + s.len; }
const total = Number(t.toFixed(3));

// ── assets ──
mkdirSync(join(dir, 'assets'), { recursive: true });
copyFileSync(take, join(dir, 'assets/take.mp4'));
if (voiced) execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-i', take, '-vn', '-c:a', 'copy', join(dir, 'assets/voice.m4a')]);

// ── where the app is: most pages leave much of the viewport empty. Per sampled frame, the box of pixels
// that differ from the page background; the median edges (so the take's own zoom-ins don't widen it) ──
function contentBox() {
  const sw = 240, sh = Math.round((sw * H) / W);
  const raw = execFileSync(FFMPEG, ['-loglevel', 'error', '-i', take, '-vf', `fps=1,scale=${sw}:${sh},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const n = Math.floor(raw.length / (sw * sh)), y0 = BAR_AT === 'top' ? Math.ceil((BAR * sh) / H) + 1 : 0;
  const y1 = BAR_AT === 'top' ? sh : sh - Math.ceil((BAR * sh) / H) - 1;
  const boxes = [];
  for (let k = 0; k < n; k++) {
    const px = (x, y) => raw[k * sw * sh + y * sw + x];
    const hist = new Uint32Array(256);
    for (let y = y0; y < y1; y++) for (let x = 0; x < sw; x++) hist[px(x, y)]++;
    const bg = hist.indexOf(Math.max(...hist));
    let [l, t, r, b] = [sw, sh, -1, -1];
    for (let y = y0; y < y1; y++) for (let x = 0; x < sw; x++)
      if (Math.abs(px(x, y) - bg) > 10) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); }
    if (r > l && b > t) boxes.push([l, t, r, b]);
  }
  if (!boxes.length) return [0, y0, sw, y1].map((v, i) => (v * (i % 2 ? H : W)) / (i % 2 ? sh : sw));
  const med = (i) => boxes.map((bx) => bx[i]).sort((a, c) => a - c)[boxes.length >> 1];
  return [med(0), med(1), med(2) + 1, med(3) + 1].map((v, i) => (v * (i % 2 ? H : W)) / (i % 2 ? sh : sw));
}
// ── layout: 1920×1080; text column left, browser card right showing the app's area ──
const pageTop = BAR_AT === 'top' ? BAR : 0, pageH = H - BAR;
const [cl, ct, cr, cb] = contentBox();
const pad = 0.06 * W, SW = 1110, SH = 800;
const s0 = Math.min(SW / (cr - cl + 2 * pad), SH / (cb - ct + 2 * pad), 1); // ≤ its own pixels: sharp, and room for callouts beside the app
const k = Math.max(s0, Math.min(SW / W, SH / pageH)); // a full-viewport app: the whole page, no crop
const winW = Math.min(W, SW / k), winH = Math.min(pageH, SH / k);
const cx = (cl + cr) / 2, cy = (ct + cb) / 2;
const winX = Math.min(Math.max(0, cx - winW / 2), W - winW), winY = Math.min(Math.max(pageTop, cy - winH / 2), pageTop + pageH - winH);
const CARD = { w: Math.round(winW * k), chrome: 52 };
const screenH = Math.round(winH * k), cardH = CARD.chrome + screenH;
CARD.x = 700 + Math.round((SW - CARD.w) / 2);
CARD.y = Math.round((1080 - cardH) / 2);
const vLeft = -Math.round(winX * k), vTop = -Math.round(winY * k), vW = Math.round(W * k);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const f = (x) => Number(x.toFixed(3));
const timed = (s, extra = '') => `data-start="${f(s.start)}" data-duration="${f(s.len)}"${extra}`;

let audioTrack = 10;
const audio = (s, id, [a, b], at = s.start) =>
  voiced ? `<audio id="${id}" src="assets/voice.m4a" data-start="${f(at)}" data-duration="${f(b - a)}" data-media-start="${f(a)}" data-track-index="${audioTrack++}"></audio>` : '';

const html = scenes.map((s, i) => {
  const id = `s${i}`;
  if (s.kind === 'title')
    return `<div class="scene" id="${id}"><div class="clip slide center" id="${id}-c" ${timed(s)}>
      <header class="stack"><p class="kicker" id="${id}-k">Product walkthrough</p><h1 id="${id}-h">${esc(s.title)}</h1>${s.sub ? `<p class="sub" id="${id}-p">${esc(s.sub)}</p>` : ''}<hr class="rule" id="${id}-r" /></header>
    </div>${audio(s, `${id}-a`, s.audio)}</div>`;
  if (s.kind === 'heading')
    return `<div class="scene" id="${id}"><div class="clip slide" id="${id}-c" ${timed(s)}>
      <header class="stack left"><p class="kicker" id="${id}-k">${s.n}</p><h2 class="big" id="${id}-h">${esc(s.text)}</h2></header>
    </div></div>`;
  if (s.kind === 'footage')
    return `<div class="scene" id="${id}">
      <div class="clip side" id="${id}-t" ${timed(s)}><p class="kicker">${s.n}</p><h2 id="${id}-h">${esc(s.text)}</h2>
        <ul class="badges">${s.badges.map((b, j) => `<li class="badge" id="${id}-b${j}"><i></i>${esc(b.text)}</li>`).join('')}</ul></div>
      <div class="clip card" id="${id}-card" ${timed(s)}><header class="chrome"><span></span><span></span><span></span></header></div>
      <div class="screen" id="${id}-scr" data-layout-allow-overflow><video id="${id}-v" src="assets/take.mp4" muted ${timed(s, ` data-media-start="${f(s.media[0])}" data-track-index="${i}"`)}></video></div>
      ${audio(s, `${id}-a`, s.media)}
    </div>`;
  if (s.kind === 'highlights')
    return `<div class="scene" id="${id}"><div class="clip slide" id="${id}-c" ${timed(s)}>
      <section class="hl"><header class="stack left"><p class="kicker">Highlights</p><h2 class="big">What it means</h2></header>
      <ul>${s.items.map((x, j) => `<li id="${id}-i${j}"><i></i>${esc(x)}</li>`).join('')}</ul></section>
    </div></div>`;
  return `<div class="scene" id="${id}"><div class="clip slide center" id="${id}-c" ${timed(s)}>
      <header class="stack"><p class="kicker">${esc(s.sub)}</p><h1 id="${id}-h">${esc(s.text)}</h1><hr class="rule" id="${id}-r" /></header>
    </div>${audio(s, `${id}-a`, s.audio)}</div>`;
}).join('\n');

// ── motion: one paused timeline ──
const tl = [];
scenes.forEach((s, i) => {
  const id = `#s${i}`;
  if (i > 0) tl.push(`tl.fromTo("${id}", { xPercent: 100 }, { xPercent: 0, duration: ${O}, ease: "power3.inOut" }, ${f(s.start)});`);
  if (i < scenes.length - 1) tl.push(`tl.to("${id}", { xPercent: -24, opacity: 0, duration: ${O}, ease: "power3.inOut" }, ${f(s.start + s.len - O)});`);
  const enter = f(s.start + (i ? O * 0.7 : 0.15));
  if (s.kind === 'title' || s.kind === 'end') {
    tl.push(`tl.fromTo("${id}-h", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, ${enter});`);
    tl.push(`tl.fromTo("${id}-r", { scaleX: 0 }, { scaleX: 1, duration: 0.8, ease: "power2.out" }, ${f(enter + 0.25)});`);
    if (s.sub && s.kind === 'title') tl.push(`tl.fromTo("${id}-p", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, ${f(enter + 0.3)});`);
  }
  if (s.kind === 'heading') tl.push(`tl.fromTo("${id}-h", { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, ${enter});`);
  if (s.kind === 'footage') {
    tl.push(`tl.fromTo("${id}-h", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, ${enter});`);
    s.badges.forEach((b, j) =>
      tl.push(`tl.fromTo("${id}-b${j}", { opacity: 0, y: 14, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.7)" }, ${f(s.start + b.at)});`));
  }
  if (s.kind === 'highlights')
    s.items.forEach((_, j) => tl.push(`tl.fromTo("${id}-i${j}", { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, ${f(enter + 0.35 + 0.4 * j)});`));
});

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>${esc(title.title)} · presentation</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
  :root { --bg: #f4f6fa; --panel: #ffffff; --ink: #0f172a; --muted: #4b5567; --line: #d9dee8; --accent: ${accent}; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: system-ui, sans-serif; }
  #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--bg); }
  .bg { position: absolute; inset: 0; background: radial-gradient(1200px 700px at 85% 15%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%), var(--bg); }
  .scene { position: absolute; inset: 0; }
  .slide { position: absolute; inset: 0; display: flex; align-items: center; padding: 0 140px; box-sizing: border-box; }
  .slide.center { justify-content: center; text-align: center; }
  .stack { display: flex; flex-direction: column; gap: 26px; max-width: 1400px; }
  .stack:not(.left) { align-items: center; }
  .kicker { margin: 0; font: 600 26px/1 ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  h1 { margin: 0; font: 800 128px/1.02 system-ui, sans-serif; letter-spacing: -.035em; }
  h2 { margin: 0; font: 800 60px/1.08 system-ui, sans-serif; letter-spacing: -.025em; }
  h2.big { font-size: 104px; max-width: 1500px; }
  .sub { margin: 0; font: 400 44px/1.3 system-ui, sans-serif; color: var(--muted); }
  .rule { border: 0; margin: 0; width: 160px; height: 6px; border-radius: 3px; background: var(--accent); transform-origin: left center; }
  .side { position: absolute; left: 110px; top: 0; bottom: 0; width: 540px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
  .badges { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 16px; align-items: flex-start; }
  .badge { display: inline-flex; align-items: center; gap: 14px; padding: 18px 26px; border-radius: 999px; background: var(--ink); color: var(--panel); font: 600 30px/1.2 system-ui, sans-serif; opacity: 0; }
  .badge i, .hl li i { width: 14px; height: 14px; border-radius: 50%; background: var(--accent); flex: none; }
  .card { position: absolute; left: ${CARD.x}px; top: ${CARD.y}px; width: ${CARD.w}px; height: ${cardH}px; border-radius: 18px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 40px 90px -30px rgba(15, 23, 42, .35); overflow: hidden; }
  .chrome { height: ${CARD.chrome}px; display: flex; align-items: center; gap: 10px; padding: 0 22px; background: #eef1f6; border-bottom: 1px solid var(--line); }
  .chrome span { width: 14px; height: 14px; border-radius: 50%; background: #c9d0dc; }
  .screen { position: absolute; left: ${CARD.x + 1}px; top: ${CARD.y + CARD.chrome + 1}px; width: ${CARD.w - 2}px; height: ${screenH - 2}px; overflow: hidden; border-radius: 0 0 17px 17px; }
  .screen video { position: absolute; left: ${vLeft}px; top: ${vTop}px; width: ${vW}px; height: auto; }
  .hl { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; width: 100%; }
  .hl ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 34px; }
  .hl li { display: flex; align-items: center; gap: 24px; font: 600 46px/1.2 system-ui, sans-serif; padding-bottom: 30px; border-bottom: 1px solid var(--line); opacity: 0; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${total}">
<div class="bg"></div>
${html}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${tl.join('\n')}
window.__timelines["main"] = tl;
</script>
</body>
</html>
`;
writeFileSync(join(dir, 'index.html'), page);
console.log(`${total.toFixed(1)} ${scenes.length}`);
