// Builds an ffmpeg filter_complex that plays the whole video at `speed`× and the fast-forward
// segments (from demo-recorder's DEMO_SEGMENTS_FILE) at `speed*factor`×.
// usage: node timeline.mjs <segments.json> <durationSec> <speed>  → prints the filter, or nothing
//        node timeline.mjs steps <steps.json> <durationSec>      → "<sec>\t<NN-slug>" per caption,
//        timed just before the next caption (the step's end state = what it was meant to show)
import { readFileSync } from 'node:fs';

if (process.argv[2] === 'steps') {
  const [, file, durArg] = process.argv.slice(2);
  let steps = [];
  try {
    steps = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  const dur = Number(durArg);
  steps.forEach((st, i) => {
    const next = i + 1 < steps.length ? steps[i + 1].t : dur;
    const at = st.at ?? Math.max(st.t + 0.2, Math.min(next - 0.4, dur - 0.2));
    const slug = st.text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50);
    console.log(`${at.toFixed(2)}\t${String(i + 1).padStart(2, '0')}-${slug}`);
  });
  process.exit(0);
}

const [file, durArg, speedArg] = process.argv.slice(2);
const dur = Number(durArg);
const speed = Number(speedArg);
let segs = [];
try {
  segs = JSON.parse(readFileSync(file, 'utf8'));
} catch {}
// keep spans long enough to matter (or cuts); clamp to the video and drop overlaps
segs = segs
  .filter((s) => s.factor > 1 && (s.end - s.start >= 1.5 || s.factor >= 100)) // ≥100 = cut (shot())
  .map((s) => ({ ...s, start: Math.max(0, s.start), end: Math.min(dur, s.end) }))
  .sort((a, b) => a.start - b.start);

const parts = [];
let cursor = 0;
for (const s of segs) {
  if (s.start < cursor) continue;
  if (s.start > cursor) parts.push([cursor, s.start, speed]);
  parts.push([s.start, s.end, speed * s.factor]);
  cursor = s.end;
}
if (!segs.length) process.exit(0);
if (cursor < dur) parts.push([cursor, dur, speed]);

const chains = parts.map(
  ([a, b, k], i) => `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=(PTS-STARTPTS)/${k}[v${i}]`
);
console.log(`${chains.join(';')};${parts.map((_, i) => `[v${i}]`).join('')}concat=n=${parts.length}:v=1:a=0[vc]`);
