// Post-production: the raw Playwright .webm → the final .mp4, -sheet.png and -steps/ frames.
// - plays the video at `speed`×, fast-forward spans (segments.json) at speed·factor×, cuts (factor ≥ 100) vanish
// - draws the caption bar ABOVE (hud.position top) or BELOW (bottom) the page, never over it: one PNG
//   per caption rendered by Chromium, stacked onto the video for exactly that caption's time
// - lays each caption's voice clip (recorded with --voice) at the caption's moment in the final cut
// - writes <stem>-chapters.json: every caption, callout, fast-forward span and still/cut in FINAL-video
//   seconds — for anything that plays the take (a player, the PR page, a preview inside another recording)
// usage: node timeline.mjs <raw-dir> <video.webm> <out-stem> <speed> <config-json>  → prints "<final> <raw>" seconds
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [dir, webm, stem, speedArg, cfgArg] = process.argv.slice(2);
const speed = Number(speedArg) || 1;
const read = (f, empty = []) => {
  try {
    return JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  } catch {
    return empty;
  }
};
// the look the spec actually used (incl. project/manifest overrides) wins over the global settings
const cfg = JSON.parse(cfgArg || '{}');
const run = read('captions.json', {});
const hud = { position: 'top', size: 'md', theme: 'dark', ...cfg.hud, ...run.hud };
const accent = run.accent ?? cfg.callout?.color ?? '#f43f5e';
const captions = run.captions ?? []; // [{ t, text, voice? }] — every caption change, ⏩ markers included
const ffmpeg = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const jobs = []; // independent ffmpeg runs (sheet, step frames) → in parallel, awaited before exit
const ffmpegBg = (args) => jobs.push(promisify(execFile)('ffmpeg', ['-loglevel', 'error', '-y', ...args]));
const ffprobe = (entries, f) =>
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', f]).toString().trim();
const dur = Number(ffprobe('format=duration', webm));
const [W, H] = ffprobe('stream=width,height', webm).split(',').map(Number);

// ── timeline: [rawStart, rawEnd, playback rate] covering the whole raw video ──
const segs = read('segments.json')
  .filter((s) => s.factor > 1 && (s.end - s.start >= 1.5 || s.factor >= 100)) // ≥100 = cut (shot, voice synthesis)
  .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(dur, s.end) }))
  .sort((a, b) => a.start - b.start);
const parts = [];
const kept = []; // the segments that made it into the cut
let cursor = 0;
for (const s of segs) {
  if (s.start < cursor || s.end <= s.start) continue;
  kept.push(s);
  if (s.start > cursor) parts.push([cursor, s.start, speed]);
  parts.push([s.start, s.end, speed * s.factor]);
  cursor = s.end;
}
if (cursor < dur) parts.push([cursor, dur, speed]);
/** raw-video second → final-video second */
const out = (t) => parts.reduce((sum, [a, b, k]) => sum + Math.max(0, Math.min(t, b) - a) / k, 0);
const total = out(dur);

// ── caption bar ──
const bar = hud.position !== 'overlay' && hud.position !== 'off';
const BAR_H = 2 * Math.round(({ sm: 28, md: 36, lg: 46 }[hud.size] ?? 36) * (W / 1680));
const inputs = ['-i', webm];
let graph = '[0:v]';
if (bar) {
  const pngs = new Map();
  for (const c of [{ text: '' }, ...captions]) if (!pngs.has(c.text)) pngs.set(c.text, `${dir}/bar-${pngs.size}.png`);
  await renderBars(pngs);
  // concat-demuxer list: each caption's PNG for as long as it was up (raw time)
  const spans = [{ t: 0, text: '' }, ...captions].map((c, i, all) => [c.text, (all[i + 1]?.t ?? dur) - c.t]).filter(([, d]) => d > 0);
  const list = spans.map(([text, d]) => `file '${pngs.get(text)}'\nduration ${d.toFixed(3)}`);
  writeFileSync(`${dir}/bar.txt`, `${list.join('\n')}\nfile '${pngs.get(spans.at(-1)[0])}'\n`);
  inputs.push('-f', 'concat', '-safe', '0', '-i', `${dir}/bar.txt`);
  const stack = hud.position === 'bottom' ? '[page][bar]' : '[bar][page]';
  graph = `[0:v]fps=30,format=yuv420p[page];[1:v]fps=30,format=yuv420p[bar];${stack}vstack=shortest=1[raw];[raw]`;
}
const chains = parts.map(([a, b, k], i) => `[s${i}]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${k}[v${i}]`);
graph +=
  `split=${parts.length}${parts.map((_, i) => `[s${i}]`).join('')};${chains.join(';')};` +
  `${parts.map((_, i) => `[v${i}]`).join('')}concat=n=${parts.length}:v=1:a=0,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30[vout]`;

// ── voice: each clip delayed to its caption's spot in the final cut ──
const voiced = captions.filter((c) => c.voice);
const maps = ['-map', '[vout]'];
if (voiced.length) {
  const first = inputs.filter((x) => x === '-i').length;
  voiced.forEach((c) => inputs.push('-i', c.voice));
  const delays = voiced.map((c, i) => `[${first + i}:a]adelay=delays=${Math.round(out(c.t) * 1000)}:all=1[a${i}]`);
  graph += `;${delays.join(';')};${voiced.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0,apad,atrim=end=${total.toFixed(3)}[aout]`;
  maps.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
}
ffmpeg([...inputs, '-filter_complex', graph, ...maps, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', `${stem}.mp4`]);

// ── verify artifacts: 3×3 contact sheet, and one frame per caption/callout at the moment it was meant to show ──
ffmpegBg(['-i', `${stem}.mp4`, '-vf', `fps=9/${total},scale=560:-1,tile=3x3`, '-frames:v', '1', `${stem}-sheet.png`]);
const steps = read('steps.json');

// ── chapters: final-video seconds of every beat ──
const sec = (t) => Number(out(t).toFixed(2));
const chapters = [
  ...steps.map((st) =>
    st.text.startsWith('↳') ? { t: sec(st.t), kind: 'callout', text: st.text.slice(2) } : { t: sec(st.t), kind: 'caption', text: st.text }
  ),
  ...kept.map((s) =>
    s.factor < 100
      ? { t: sec(s.start), end: sec(s.end), kind: 'fastForward', text: captions.findLast((c) => c.t <= s.start)?.text ?? '' }
      : { t: sec(s.start), kind: s.label ? 'still' : 'cut', text: s.label ?? '' }
  ),
].sort((a, b) => a.t - b.t);
writeFileSync(`${stem}-chapters.json`, `[\n${chapters.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`);

if (steps.length) mkdirSync(`${stem}-steps`, { recursive: true });
steps.forEach((st, i) => {
  const next = i + 1 < steps.length ? steps[i + 1].t : dur;
  const at = st.at ?? Math.max(st.t + 0.2, Math.min(next - 0.4, dur - 0.2)); // the step's end state
  const slug = st.text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50);
  ffmpegBg(['-ss', Math.min(out(at), total - 0.05).toFixed(3), '-i', `${stem}.mp4`, '-frames:v', '1', `${stem}-steps/${String(i + 1).padStart(2, '0')}-${slug}.png`]);
});
await Promise.all(jobs);
console.log(`${total.toFixed(1)} ${dur.toFixed(1)}`);

/** One W×BAR_H PNG per distinct caption, drawn by Chromium so type and emoji render like the app. */
async function renderBars(pngs) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: BAR_H } });
  const light = hud.theme === 'light';
  const edge = hud.position === 'bottom' ? 'top' : 'bottom';
  const font = Math.round(BAR_H * 0.42);
  for (const [text, file] of pngs) {
    await page.setContent(
      `<body style="margin:0"><div id="bar" style="box-sizing:border-box;width:${W}px;height:${BAR_H}px;display:flex;` +
        `align-items:center;justify-content:center;padding:0 ${font * 2}px;background:${light ? '#ffffff' : '#0f172a'};` +
        `color:${light ? '#0f172a' : '#f8fafc'};border-${edge}:${Math.max(2, Math.round(BAR_H / 24))}px solid ${accent};` +
        `font:600 ${font}px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;letter-spacing:.2px;white-space:nowrap">` +
        `<span id="t"></span></div></body>`
    );
    // textContent, not HTML: captions are data. Shrink until one line fits.
    await page.evaluate((t) => {
      const el = document.getElementById('t');
      el.textContent = t;
      const bar = document.getElementById('bar');
      for (let px = parseFloat(getComputedStyle(bar).fontSize); el.offsetWidth > bar.clientWidth * 0.94 && px > 10; px--) bar.style.fontSize = `${px}px`;
    }, text);
    await page.locator('#bar').screenshot({ path: file });
  }
  await browser.close();
}
