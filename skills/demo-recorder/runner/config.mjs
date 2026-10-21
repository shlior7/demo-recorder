// Settings = runner/config.defaults.json deep-merged with $DEMO_HOME/config.json (user's choices).
// usage: node config.mjs <defaults> <user>                 → print merged JSON
//        node config.mjs <defaults> <user> <key>           → print one value (dot path)
//        node config.mjs <defaults> <user> <key> <value>   → set in user file (validated)
import { readFileSync, writeFileSync } from 'node:fs';

const [defaultsFile, userFile, key, value] = process.argv.slice(2);
const read = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return {};
  }
};
const merge = (a, b) =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [
      k,
      a[k] && typeof a[k] === 'object' && b[k] && typeof b[k] === 'object' ? merge(a[k], b[k]) : (b[k] ?? a[k]),
    ])
  );
const get = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);

const ALLOWED = {
  'hud.position': ['top', 'bottom', 'overlay', 'off'],
  'hud.size': ['sm', 'md', 'lg'],
  'hud.theme': ['dark', 'light'],
  'share.pr': ['always', 'ask', 'never', 'unset'],
  'share.jira': ['always', 'ask', 'never', 'unset'],
  'share.video': ['attach', 'page', 'link'],
  'callout.ring': ['true', 'false'],
  'callout.inShots': ['true', 'false'],
  'voice.enabled': ['true', 'false'],
  'voice.energy': ['calm', 'warm', 'upbeat', 'rainbow'],
  audience: ['none', 'dev', 'exec', 'pm'],
  'motion.pop': ['true', 'false'],
};

// audience → a preset under the user's own settings (anything set explicitly still wins). The caption
// TONE per audience is the agent's job (SKILL.md); this sets the delivery: voice, size, motion, pace.
const AUDIENCE = {
  dev: { speed: 1.15, hud: { size: 'sm' }, voice: { energy: 'calm' }, motion: { zoom: 0.85, cursor: 0.8, pop: false } }, // dry
  exec: { speed: 1, hud: { size: 'md' }, voice: { energy: 'warm' }, motion: { zoom: 1, cursor: 1, pop: false } }, // flattering
  pm: { speed: 1, hud: { size: 'lg' }, voice: { energy: 'rainbow' }, motion: { zoom: 1.25, cursor: 1.2, pop: true } }, // over the top
};

const defaults = read(defaultsFile);
const user = read(userFile);
// $DEMO_AUDIENCE: this run's audience (--audience, the manifest or project.json) over the saved one
const audience = process.env.DEMO_AUDIENCE || user.audience || defaults.audience;
const merged = { ...merge(merge(defaults, AUDIENCE[audience] ?? {}), user), audience };

if (!key) console.log(JSON.stringify(merged, null, 2));
else if (value === undefined) {
  const v = get(merged, key) ?? '';
  console.log(typeof v === 'object' ? JSON.stringify(v) : v); // a section (`config voice`) is JSON for voice.py
}
else {
  if (get(defaults, key) === undefined) throw new Error(`unknown setting ${key}`);
  if (ALLOWED[key] && !ALLOWED[key].includes(value)) throw new Error(`${key}: one of ${ALLOWED[key].join(' | ')}`);
  const parts = key.split('.');
  let o = user;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value === 'true' ? true : value === 'false' ? false : value;
  writeFileSync(userFile, JSON.stringify(user, null, 2) + '\n');
  console.log(`${key} = ${value}`);
}
