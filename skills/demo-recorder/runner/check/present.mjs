// Regression: present.mjs turns a take into title → (heading + footage) per chapter → highlights → end card,
// each footage clip and voice line cut from the caption's stretch of the take, caption bar cropped off.
// Synthetic take (ffmpeg testsrc + a tone), no HyperFrames needed.   node skills/demo-recorder/runner/check/present.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'present-'));
const take = join(dir, 'demo-1.mp4');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
execFileSync(FFMPEG, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1680x1122:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=20',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', take]);
const chapters = [
  { t: 0, kind: 'frame', text: '', bar: 72, at: 'top' },
  { t: 0, kind: 'caption', text: 'Acme · ship faster' },
  { t: 4, kind: 'caption', text: 'Add an item' },
  { t: 6, kind: 'callout', text: 'Saved instantly' },
  { t: 10, kind: 'caption', text: 'Share it' },
  { t: 12, kind: 'callout', text: 'Everyone sees it' },
  { t: 12.5, kind: 'still', text: 'shared' },
  { t: 16, kind: 'caption', text: 'That is it' },
];
writeFileSync(join(dir, 'demo-1-chapters.json'), JSON.stringify(chapters));

const out = join(dir, 'present');
const [len, scenes] = execFileSync('node', [new URL('../present.mjs', import.meta.url).pathname, take, out, '{"hud":{"accent":"#00aa88"}}']).toString().trim().split(' ').map(Number);
const html = readFileSync(join(out, 'index.html'), 'utf8');
assert.equal(scenes, 7, 'title + 2 × (heading + footage) + highlights + end');
assert.ok(existsSync(join(out, 'assets/take.mp4')) && existsSync(join(out, 'assets/voice.m4a')), 'take + its voice track copied in');
assert.match(html, /<h1 id="s0-h">Acme<\/h1>/, 'title card from the first caption, before " · "');
assert.match(html, /class="sub" id="s0-p">ship faster</, 'subtitle after it');
// footage = the caption's stretch of the take, its voice the same range
const media = [...html.matchAll(/<video id="(s\d+)-v"[^>]*data-media-start="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])]);
assert.deepEqual(media.map((m) => m[1]), [4, 10], 'one footage clip per middle caption, starting at its caption');
const voice = [...html.matchAll(/<audio id="s\d+-a"[^>]*data-duration="([\d.]+)" data-media-start="([\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);
assert.deepEqual(voice, [[0, 4], [4, 6], [10, 6], [16, 4]], 'voice lines cut from the same stretches (title + footage + end card)');
assert.match(html, /<li class="badge" id="s2-b0"><i><\/i>Saved instantly<\/li>/, 'callout → badge on its chapter');
assert.match(html, /tl\.fromTo\("#s2-b0"[^;]*, 7\.\d+\);/, 'badge pops at the callout time (6 s into the take → 2 s into its footage)');
assert.match(html, /Everyone sees it<\/li>[\s\S]*<h2 class="big">What it means/, 'highlights slide once there are ≥ 2 callouts');
assert.match(html, /\.screen video \{[^}]*top: -\d+px/, 'video shifted up: the caption bar is cropped');
assert.match(html, /--accent: #00aa88/, 'accent from the take\'s look');
const starts = [...html.matchAll(/class="clip slide[^"]*" id="s(\d+)-c" data-start="([\d.]+)" data-duration="([\d.]+)"/g)];
assert.ok(starts.length >= 3 && Math.abs(len - Number(html.match(/data-duration="([\d.]+)">\n<div class="bg">/)[1])) < 0.01, 'root duration = printed length');
console.log('present: ok');
