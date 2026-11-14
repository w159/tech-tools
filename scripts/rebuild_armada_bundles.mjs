#!/usr/bin/env node
// Rebuild every shipped armada MCP bundle (plugins/armada/mcp/<svc>/server.mjs)
// from mcp_servers/<svc>-mcp with a pinned toolchain, byte-reproducibly.
//
// Usage:
//   node scripts/rebuild_armada_bundles.mjs                  # rebuild all, write to shipped paths
//   node scripts/rebuild_armada_bundles.mjs --out /tmp/x     # write <out>/<svc>/server.mjs + <out>/bundles.lock.json
//   node scripts/rebuild_armada_bundles.mjs --only auvik,vanta
//   node scripts/rebuild_armada_bundles.mjs --check-pins     # verify toolchain pins only, build nothing
//
// Pins (single source of truth): mcp_servers/_toolchain/package.json + package-lock.json
//   tsup 8.5.1, esbuild 0.28.2 (tsup 8.5.1 declares esbuild ^0.27; the override forces 0.28.2),
//   Node 22.x (EXPECTED_NODE_MAJOR below). Each connector's own dependencies come from its
//   package-lock.json via `npm ci`; only the bundler is taken from the toolchain dir.
//
// Provenance: <out>/bundles.lock.json records, per bundle, the sha256 of its sources
// (see sourceHash) and of the built file. plugins/armada/tests/test_armada_bundles.py
// recomputes both without Node and fails when they drift.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVERS = join(ROOT, 'mcp_servers');
const NODE_LIBS = join(ROOT, 'mcp_node');
const TOOLCHAIN = join(SERVERS, '_toolchain');
const SHIPPED = join(ROOT, 'plugins/armada/mcp');
const EXPECTED_NODE_MAJOR = 22;
const LOCK_NAME = 'bundles.lock.json';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '__tests__', 'tests', 'coverage']);

function fail(msg) {
  console.error(`rebuild_armada_bundles: ${msg}`);
  process.exit(1);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

// Local `file:../../mcp_node/<lib>` dependencies of a connector (they are built before the bundle).
function localLibs(pkgDir) {
  const pkg = readJson(join(pkgDir, 'package.json'));
  const libs = [];
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
    const dir = resolve(pkgDir, spec.slice(5));
    if (dir !== join(NODE_LIBS, name)) fail(`${pkgDir}: file: dependency ${name} -> ${dir} is not under mcp_node/${name}`);
    libs.push({ name, dir });
  }
  return libs;
}

// Inputs that determine a bundle: the connector's src/ tree, its bundle config, package.json,
// package-lock.json, tsconfig.json, the same set for each local mcp_node/<lib> dependency
// (plus its tsup.config.ts), and the shared sources aliased as @shared (top-level
// mcp_servers/_shared files; _shared tests are excluded). Hash is over sorted
// "<posix path relative to repo root>\0<file sha256>\n" lines so it is independent of checkout
// location. plugins/armada/tests/test_armada_bundles.py implements the identical algorithm.
export function sourceHash(pkgDir) {
  const files = [];
  const add = (p) => existsSync(p) && files.push(p);
  walk(join(pkgDir, 'src'), files);
  for (const n of ['tsup.bundle.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json']) add(join(pkgDir, n));
  for (const { dir } of localLibs(pkgDir)) {
    walk(join(dir, 'src'), files);
    for (const n of ['tsup.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json']) add(join(dir, n));
  }
  const shared = join(SERVERS, '_shared');
  for (const n of readdirSync(shared).sort()) {
    const p = join(shared, n);
    if (statSync(p).isFile()) files.push(p);
  }
  const lines = files
    .map((p) => [relative(ROOT, p).split(sep).join('/'), sha256(readFileSync(p))])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([r, h]) => `${r}\0${h}\n`);
  return sha256(lines.join(''));
}

function run(cmd, args, cwd, label) {
  const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, npm_config_update_notifier: 'false' } });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status ?? r.signal})`);
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function toolchainPins() {
  const pkg = readJson(join(TOOLCHAIN, 'package.json'));
  const lock = readJson(join(TOOLCHAIN, 'package-lock.json'));
  const pins = { node_major: EXPECTED_NODE_MAJOR, tsup: pkg.devDependencies.tsup, esbuild: pkg.devDependencies.esbuild };
  for (const k of ['tsup', 'esbuild']) {
    const locked = lock.packages[`node_modules/${k}`]?.version;
    if (locked !== pins[k]) fail(`toolchain lockfile resolves ${k}@${locked}, package.json pins ${pins[k]}`);
    if (!/^\d+\.\d+\.\d+$/.test(pins[k])) fail(`toolchain pin for ${k} must be an exact version, got ${pins[k]}`);
  }
  return pins;
}

function discover() {
  const found = [];
  for (const name of readdirSync(SERVERS).sort()) {
    const cfg = join(SERVERS, name, 'tsup.bundle.config.ts');
    if (!existsSync(cfg)) continue;
    const m = /plugins\/armada\/mcp\/([a-z0-9_-]+)'/.exec(readFileSync(cfg, 'utf8'));
    if (!m) fail(`${cfg}: cannot find the plugins/armada/mcp/<svc> outDir`);
    found.push({ svc: m[1], pkgDir: join(SERVERS, name), cfg });
  }
  return found.sort((a, b) => (a.svc < b.svc ? -1 : 1));
}

function parseArgs(argv) {
  const o = { out: SHIPPED, only: null, checkPins: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = resolve(argv[++i] ?? fail('--out needs a directory'));
    else if (a === '--only') o.only = (argv[++i] ?? fail('--only needs a list')).split(',');
    else if (a === '--check-pins') o.checkPins = true;
    else fail(`unknown argument ${a}`);
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const pins = toolchainPins();
if (opts.checkPins) {
  console.log(JSON.stringify(pins));
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) !== EXPECTED_NODE_MAJOR) {
  fail(`Node ${EXPECTED_NODE_MAJOR}.x required (running ${process.versions.node}); bundles are pinned to that toolchain`);
}

const all = discover();
const wanted = opts.only ? all.filter((s) => opts.only.includes(s.svc)) : all;
if (opts.only && wanted.length !== opts.only.length) fail(`unknown service in --only; known: ${all.map((s) => s.svc).join(',')}`);

console.log(`toolchain: node ${process.versions.node}, tsup ${pins.tsup}, esbuild ${pins.esbuild}`);
run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], TOOLCHAIN, 'npm ci (toolchain)');
const tsupCli = join(TOOLCHAIN, 'node_modules/tsup/dist/cli-default.js');
if (!existsSync(tsupCli)) fail(`tsup CLI not found at ${tsupCli}`);

mkdirSync(opts.out, { recursive: true });
const lockPath = join(opts.out, LOCK_NAME);
const prev = existsSync(lockPath) ? readJson(lockPath).bundles ?? {} : {};
const bundles = { ...prev };
for (const { svc, pkgDir, cfg } of wanted) {
  console.log(`== ${svc} (${relative(ROOT, pkgDir)})`);
  // Local mcp_node libs first: install from their lockfile, build ESM+CJS with the pinned tsup.
  // --no-dts: type declarations never reach the bundle, and the toolchain has no typescript.
  for (const { name, dir } of localLibs(pkgDir)) {
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], dir, `npm ci (${name})`);
    run(process.execPath, [tsupCli, '--no-dts', '--silent'], dir, `tsup (${name})`);
  }
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], pkgDir, `npm ci (${svc})`);
  const outDir = join(opts.out, svc);
  mkdirSync(outDir, { recursive: true });
  // CLI flags are merged over the config file (tsup docs: cli.md), so -d redirects outDir.
  run(process.execPath, [tsupCli, '--config', cfg, '-d', outDir, '--silent'], pkgDir, `tsup (${svc})`);
  const file = join(outDir, 'server.mjs');
  if (!existsSync(file)) fail(`${svc}: tsup produced no server.mjs`);
  const data = readFileSync(file);
  bundles[svc] = { package: relative(ROOT, pkgDir).split(sep).join('/'), source_sha256: sourceHash(pkgDir), bundle_sha256: sha256(data), bytes: data.length };
  console.log(`   ${bundles[svc].bytes} bytes sha256 ${bundles[svc].bundle_sha256}`);
}

const sorted = Object.fromEntries(Object.keys(bundles).sort().map((k) => [k, bundles[k]]));
writeFileSync(lockPath, `${JSON.stringify({ toolchain: pins, bundles: sorted }, null, 2)}\n`);
console.log(`wrote ${relative(ROOT, lockPath)}`);
