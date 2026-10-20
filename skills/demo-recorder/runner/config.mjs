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
  'hud.position': ['top', 'bottom', 'auto', 'off'],
  'hud.size': ['sm', 'md', 'lg'],
  'hud.theme': ['dark', 'light'],
  'share.pr': ['always', 'ask', 'never', 'unset'],
  'share.jira': ['always', 'ask', 'never', 'unset'],
  'share.video': ['attach', 'page', 'link'],
  'callout.ring': ['true', 'false'],
  'callout.inShots': ['true', 'false'],
};

const defaults = read(defaultsFile);
const user = read(userFile);
const merged = merge(defaults, user);

if (!key) console.log(JSON.stringify(merged, null, 2));
else if (value === undefined) console.log(get(merged, key) ?? '');
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
