// Saved logins (Playwright storageState) for apps / GitHub, two ways:
//   node login.mjs open <url> <out.json> <browser> <profileDir>
//       Opens a REAL browser window (brave|chrome|chromium) on a dedicated profile; the user logs in;
//       the session is saved every 2s and on close.
//   node login.mjs import <browser> <out.json> <domain>
//       Reuses the user's EXISTING login (macOS): reads a temp copy of each profile's cookie DB,
//       decrypts only <domain>'s cookies with the browser's Keychain key, deletes the copy.
//       The real profile is only read; macOS asks once to allow Keychain access.
import { chromium } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const MAC = {
  brave: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', 'BraveSoftware/Brave-Browser'],
  chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Google/Chrome'],
};
const LINUX = {
  brave: ['/usr/bin/brave-browser', '.config/BraveSoftware/Brave-Browser'],
  chrome: ['/usr/bin/google-chrome', '.config/google-chrome'],
};
const table = process.platform === 'darwin' ? MAC : LINUX;
const base = (b) => (process.platform === 'darwin' ? join(homedir(), 'Library/Application Support', table[b][1]) : join(homedir(), table[b][1]));
const exe = (b) => {
  if (!b || b === 'chromium') return undefined;
  if (!table[b]) throw new Error(`unknown browser ${b} (brave | chrome | chromium)`);
  if (!existsSync(table[b][0])) throw new Error(`${b} not found at ${table[b][0]}`);
  return table[b][0];
};
const save = (out, state) => writeFileSync(out, JSON.stringify(state), { mode: 0o600 });
// Playwright passes --use-mock-keychain by default, which would make real cookies undecryptable.
const keychain = { ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic', '--enable-automation'] };

const [mode, a, b, c, d] = process.argv.slice(2);

if (mode === 'open') {
  const [url, out, browser, profileDir] = [a, b, c, d];
  const ctx = await chromium.launchPersistentContext(profileDir, { executablePath: exe(browser), headless: false, viewport: null, ...keychain });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(url);
  let closed = false;
  ctx.on('close', () => (closed = true));
  while (!closed) {
    await ctx.storageState().then((s) => save(out, s)).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`saved ${out}`);
} else if (mode === 'import') {
  // Decrypt the cookie DB directly (what browser_cookie3 & co do): launching the browser on a copied
  // profile doesn't work — Chromium silently drops cookies it can't decrypt there.
  // macOS only: key = PBKDF2(Keychain "<Browser> Safe Storage", 'saltysalt', 1003, 16, sha1), AES-128-CBC.
  const [browser, out, domain] = [a, b, c];
  if (process.platform !== 'darwin') throw new Error('--from import is macOS-only; use --browser to log in instead');
  const root = base(browser);
  const service = { brave: 'Brave Safe Storage', chrome: 'Chrome Safe Storage' }[browser];
  if (!service || !existsSync(root)) throw new Error(`no ${browser} profile at ${root}`);
  const { execFileSync } = await import('node:child_process');
  const { createDecipheriv, pbkdf2Sync } = await import('node:crypto');
  const profiles = readdirSync(root).filter((n) => n === 'Default' || /^Profile \d+$/.test(n));
  let key;
  for (const profile of profiles) {
    const db = [join(root, profile, 'Network/Cookies'), join(root, profile, 'Cookies')].find(existsSync);
    if (!db) continue;
    const tmp = mkdtempSync(join(tmpdir(), 'demo-login-'));
    try {
      cpSync(db, join(tmp, 'Cookies')); // read a copy — never touch the live DB
      const q = (sql) => JSON.parse(execFileSync('sqlite3', ['-json', join(tmp, 'Cookies'), sql], { encoding: 'utf8' }) || '[]');
      const version = Number(q("select value from meta where key='version'")[0]?.value ?? 0);
      const like = domain.replace(/'/g, "''");
      const rows = q(`select host_key, name, value, hex(encrypted_value) as ev, path, expires_utc, is_secure, is_httponly, samesite
                      from cookies where host_key = '${like}' or host_key like '%.${like}'`);
      if (!rows.length) continue;
      key ??= pbkdf2Sync(execFileSync('security', ['find-generic-password', '-w', '-s', service], { encoding: 'utf8' }).trim(), 'saltysalt', 1003, 16, 'sha1');
      const decrypt = (hex) => {
        const buf = Buffer.from(hex, 'hex');
        if (buf.subarray(0, 3).toString() !== 'v10') return '';
        const d = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
        const plain = Buffer.concat([d.update(buf.subarray(3)), d.final()]);
        return (version >= 24 ? plain.subarray(32) : plain).toString('utf8'); // v24+: sha256(host) prefix
      };
      const cookies = rows.map((r) => ({
        name: r.name,
        value: r.value || decrypt(r.ev),
        domain: r.host_key,
        path: r.path,
        expires: Number(r.expires_utc) > 0 ? Math.floor(Number(r.expires_utc) / 1e6 - 11644473600) : -1,
        httpOnly: !!Number(r.is_httponly),
        secure: !!Number(r.is_secure),
        sameSite: { 0: 'None', 1: 'Lax', 2: 'Strict' }[Number(r.samesite)] ?? 'Lax',
      }));
      // GitHub sets _gh_sess even when logged out — its real signal is logged_in=yes
      const loggedIn = /(^|\.)github\.com$/.test(domain)
        ? cookies.some((k) => k.name === 'logged_in' && k.value === 'yes')
        : cookies.some((k) => /session|token|auth/i.test(k.name) && k.value);
      if (loggedIn) {
        save(out, { cookies, origins: [] });
        console.log(`imported ${cookies.length} ${domain} cookies from ${browser} "${profile}" → ${out}`);
        process.exit(0);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.error(`✗ no logged-in ${domain} session in any ${browser} profile (${profiles.join(', ')}) — log in there first`);
  process.exit(1);
} else {
  console.error('usage: login.mjs open <url> <out> <browser> <profileDir> | import <browser> <out> <domain>');
  process.exit(2);
}
