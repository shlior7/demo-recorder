// Per-project settings (project.json) — everything that differs between apps/repos.
// Lookup: <repo>/.demo-recorder/project.json (team, committed) → $DEMO_HOME/projects/<name>/project.json
// (personal). <name> = --project, else the projects/<name>/ folder a spec lives in, else the git
// origin repo name of the cwd, else the demo file's folder name.
//
//   node project.mjs resolve <home> <name|-> <spec|-> <cwd>   → JSON {name, file, root, config}
//   node project.mjs init <home> <name|-> <cwd> [--team]       → scaffold (detects dev script + port)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const [cmd, home, nameArg, x, y, flag] = process.argv.slice(2);
const sh = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const gitRoot = (cwd) => sh(['rev-parse', '--show-toplevel'], cwd);
const repoName = (cwd) => {
  const url = sh(['remote', 'get-url', 'origin'], cwd);
  return url ? basename(url).replace(/\.git$/, '') : basename(gitRoot(cwd) || cwd);
};
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

function nameFor(spec, cwd) {
  if (nameArg && nameArg !== '-') return nameArg;
  if (spec && spec !== '-') {
    const rel = relative(join(home, 'projects'), resolve(spec));
    if (!rel.startsWith('..')) return rel.split('/')[0];
    if (!gitRoot(cwd)) return basename(dirname(resolve(spec))); // not in a repo → the demo's folder
  }
  return repoName(cwd);
}

if (cmd === 'resolve') {
  const [spec, cwd] = [x, y];
  const name = nameFor(spec, cwd);
  const root = gitRoot(cwd);
  const candidates = [root && join(root, '.demo-recorder/project.json'), join(home, 'projects', name, 'project.json')].filter(Boolean);
  const file = candidates.find(existsSync) ?? '';
  const config = file ? read(file) : {};
  console.log(JSON.stringify({ name: config.name ?? name, file, root: config.root || root || cwd, config }));
} else if (cmd === 'init') {
  const cwd = x;
  const root = gitRoot(cwd) || cwd;
  const name = nameArg && nameArg !== '-' ? nameArg : repoName(cwd);
  const team = flag === '--team' || y === '--team';
  const file = team ? join(root, '.demo-recorder/project.json') : join(home, 'projects', name, 'project.json');
  if (existsSync(file)) {
    console.log(`exists: ${file}`);
    process.exit(0);
  }
  // Best-effort detection: package manager from the lockfile, dev script, default port per framework.
  const pkgFile = join(root, 'package.json');
  const pkg = existsSync(pkgFile) ? read(pkgFile) : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const pm = existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(root, 'yarn.lock')) ? 'yarn'
    : existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock')) ? 'bun' : 'npm';
  const script = ['dev', 'start', 'serve'].find((s) => pkg.scripts?.[s]);
  const port = deps.next ? 3000 : deps['@angular/core'] ? 4200 : deps.astro ? 4321 : deps.gatsby ? 8000
    : deps.vite || deps['@sveltejs/kit'] ? 5173 : deps.nuxt || deps['react-scripts'] || deps['@remix-run/dev'] ? 3000
    : existsSync(join(root, 'manage.py')) ? 8000 : existsSync(join(root, 'Gemfile')) ? 3000 : 3000;
  const command = script ? (pm === 'npm' ? `npm run ${script}` : `${pm} ${script}`)
    : existsSync(join(root, 'manage.py')) ? 'python manage.py runserver' : '';
  const baseUrl = `http://localhost:${port}`;
  const config = {
    name,
    ...(team ? {} : { root }),
    baseUrl,
    start: command ? [{ name: 'app', cwd: '.', command, ready: baseUrl }] : [],
    setup: existsSync(pkgFile) ? `${pm} install` : '', // run in a cached worktree when its HEAD moves (record-demo.sh worktree)
    auth: null,
    viewport: '1680x1050',
    colorScheme: 'light',
    forbid: ['/delete/i', '/remove/i', '/publish/i', '/deploy/i'],
    failOn: [{ text: '/something went wrong|internal server error/i' }],
    localStorage: {},
    look: {},
    notes: ['Detected automatically — verify baseUrl and start[] (multi-process apps need one entry per process).'],
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  console.log(`created: ${file}`);
} else {
  console.error('usage: project.mjs resolve|init …');
  process.exit(2);
}
