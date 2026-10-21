// Regression: audience presets sit UNDER the user's own settings, $DEMO_AUDIENCE (--audience) beats the saved
// one, and no audience = today's defaults.   node skills/demo-recorder/runner/check/config-audience.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = new URL('..', import.meta.url).pathname;
const user = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.json');
const cfg = (u, env = {}) => {
  writeFileSync(user, JSON.stringify(u));
  return JSON.parse(execFileSync('node', [join(dir, 'config.mjs'), join(dir, 'config.defaults.json'), user], { env: { ...process.env, ...env } }));
};

const plain = cfg({});
assert.equal(plain.audience, 'none');
assert.deepEqual([plain.speed, plain.hud.size, plain.voice.energy, plain.motion], [1, 'md', 'upbeat', { zoom: 1, cursor: 1, pop: false }]);

const pm = cfg({}, { DEMO_AUDIENCE: 'pm' });
assert.deepEqual([pm.hud.size, pm.voice.energy, pm.motion.zoom, pm.motion.pop], ['lg', 'rainbow', 1.25, true]);

const mine = cfg({ audience: 'dev', voice: { energy: 'warm' }, hud: { background: '#000' } });
assert.equal(mine.audience, 'dev');
assert.equal(mine.voice.energy, 'warm', 'an explicit setting beats the preset');
assert.equal(mine.hud.size, 'sm');
assert.equal(mine.hud.background, '#000');
assert.equal(mine.speed, 1.15);

assert.equal(cfg({ audience: 'dev' }, { DEMO_AUDIENCE: 'exec' }).voice.energy, 'warm', '--audience beats the saved audience');
console.log('config audience: ok');
