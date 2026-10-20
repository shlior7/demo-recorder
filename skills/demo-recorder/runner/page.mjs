// One static page per PR: every `share --video page` adds a take (its own tab: commit, date, video,
// screenshots), earlier takes stay. State lives in <page>/takes.json next to the media; index.html
// is re-rendered from it each time.
// usage: node page.mjs <pageDir> add '<take JSON>' '<meta JSON>'   → prints the take id
//        node page.mjs <pageDir> set commentId <id>                → remember the PR comment
//        node page.mjs <pageDir> get commentId
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, cmd, a, b] = process.argv.slice(2);
const file = join(dir, 'takes.json');
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { takes: [] };
const save = () => writeFileSync(file, JSON.stringify(state, null, 2) + '\n');

if (cmd === 'get') {
  console.log(state[a] ?? '');
  process.exit(0);
}
if (cmd === 'set') {
  state[a] = b;
  save();
  process.exit(0);
}
if (cmd === 'add') {
  Object.assign(state, JSON.parse(b || '{}')); // repo, pr, prUrl, branch — latest wins
  const take = JSON.parse(a);
  state.takes = state.takes.filter((t) => t.id !== take.id).concat(take);
  save();
  console.log(take.id);
}

const data = JSON.stringify(state).replace(/</g, '\\u003c');
writeFileSync(
  join(dir, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo · ${(state.repo || '').replace(/[<&"]/g, '')} #${state.pr || ''}</title>
<style>
:root{--bg:#f8fafc;--fg:#0f172a;--muted:#64748b;--card:#fff;--line:#e2e8f0;--accent:#2563eb;--tab:#eef2f7}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--fg:#e2e8f0;--muted:#94a3b8;--card:#111827;--line:#1f2937;--accent:#60a5fa;--tab:#162033}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
header h1{font-size:22px;margin:0 0 4px}header p{color:var(--muted);margin:0}a{color:var(--accent)}
nav{position:sticky;top:0;z-index:2;background:var(--bg);display:flex;gap:8px;overflow-x:auto;padding:16px 0 12px;border-bottom:1px solid var(--line);margin-bottom:20px}
nav button{flex:none;border:1px solid var(--line);background:var(--tab);color:var(--fg);border-radius:10px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer;text-align:left}
nav button[aria-selected=true]{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
nav small{display:block;color:var(--muted);font-size:12px}
h2{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 16px;font-size:14px}
video{width:100%;border-radius:12px;background:#000;box-shadow:0 10px 30px rgba(0,0,0,.18);display:block}
h3{font-size:17px;margin:32px 0 12px}
.masonry{display:flex;gap:16px;align-items:flex-start}.masonry>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px}
.masonry figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px}
.masonry img{width:100%;height:auto;display:block;border-radius:8px}
.masonry figcaption{font-size:13px;color:var(--muted);margin:8px 4px 2px}
</style></head><body><main>
<header><h1 id="h"></h1><p id="meta"></p></header>
<nav id="tabs" role="tablist"></nav>
<section id="take" role="tabpanel"></section>
</main>
<script>
const S = ${data};
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const takes = [...S.takes].reverse(); // newest first
document.getElementById('h').textContent = (S.title || 'Demo') ;
const meta = document.getElementById('meta');
meta.append('Branch ', el('code', { textContent: S.branch || '' }));
if (S.prUrl) meta.append(' · ', el('a', { href: S.prUrl, target: '_blank', rel: 'noopener', textContent: (S.repo || '') + '#' + S.pr }));
meta.append(' · ' + takes.length + ' recording' + (takes.length === 1 ? '' : 's'));
const tabs = document.getElementById('tabs'), panel = document.getElementById('take');
function show(id) {
  const t = takes.find((x) => x.id === id) || takes[0];
  if (!t) return;
  for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.id === t.id));
  panel.replaceChildren(
    el('h2', { textContent: t.title }),
    el('p', { className: 'sub', textContent: [t.sha && 'commit ' + t.sha, t.subject, new Date(t.date).toLocaleString(), t.dur && t.dur + 's'].filter(Boolean).join(' · ') }),
    player(t),
    ...(t.shots && t.shots.length ? [el('h3', { textContent: 'Screenshots' }),
      masonry(t.shots)] : []));
  if (location.hash.slice(1) !== t.id) history.replaceState(null, '', '#' + t.id);
}
// Many static hosts ignore HTTP Range requests (always 200, whole file), so a plain <video src>
// can't seek there. Fetch the mp4 once and play it from a blob URL — blobs are always seekable.
const blobs = {};
function player(t) {
  const wrap = el('div', { style: 'position:relative' });
  const v = el('video', { controls: true, playsInline: true, preload: 'auto' });
  const note = el('div', { textContent: 'Loading video…', style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;pointer-events:none' });
  wrap.append(v, note);
  const done = (url) => { v.src = url; note.remove(); };
  if (blobs[t.id]) done(blobs[t.id]);
  else
    fetch(t.video)
      .then(async (r) => {
        if (!r.ok || !r.body) throw new Error(r.status);
        const total = Number(r.headers.get('content-length')) || 0, reader = r.body.getReader(), parts = [];
        for (let got = 0; ; ) {
          const { done: end, value } = await reader.read();
          if (end) break;
          parts.push(value); got += value.length;
          if (total) note.textContent = 'Loading video… ' + Math.round((got / total) * 100) + '%';
        }
        done((blobs[t.id] = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }))));
      })
      .catch(() => done(t.video)); // still plays, just without seeking
  return wrap;
}

// Masonry: each still goes to the currently shortest column (by its real aspect ratio).
function masonry(shots) {
  const box = el('div', { className: 'masonry' });
  const figs = shots.map((s) => el('figure', {},
    el('a', { href: s.file, target: '_blank', rel: 'noopener' }, el('img', { src: s.file, alt: s.caption })),
    el('figcaption', { textContent: s.caption })));
  const layout = () => {
    const n = Math.max(1, Math.min(figs.length, Math.floor((box.clientWidth || 1100) / 330)));
    const cols = Array.from({ length: n }, () => el('div')), h = Array(n).fill(0);
    for (const f of figs) {
      const img = f.querySelector('img'), i = h.indexOf(Math.min(...h));
      cols[i].append(f);
      h[i] += (img.naturalHeight / img.naturalWidth || 0.62) + 0.12; // + caption
    }
    box.replaceChildren(...cols);
  };
  Promise.all(figs.map((f) => f.querySelector('img').decode().catch(() => {}))).then(layout);
  let last = 0; new ResizeObserver(() => { const w = box.clientWidth; if (Math.abs(w - last) > 40) { last = w; layout(); } }).observe(box);
  return box;
}
takes.forEach((t, i) => tabs.append(el('button', { role: 'tab', onclick: () => show(t.id) },
  (i === 0 ? 'Latest · ' : '') + (t.sha || t.id), el('small', { textContent: new Date(t.date).toLocaleDateString() + ' · ' + (t.label || t.title).slice(0, 48) }))));
[...tabs.children].forEach((b, i) => (b.dataset.id = takes[i].id));
addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));
</script></body></html>
`
);
