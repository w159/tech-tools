#!/usr/bin/env node
// Boot + safety-signal gate for every shipped atlas MCP connector bundle.
//
// AGENTS.md section 1 lists this file as part of the "tools" product surface and
// section 2 makes `node test-mcp-tools.mjs <svc>` a mandatory propagation check
// ("Boot test passes without tool-count regression"). This is that harness.
//
// Usage:
//   node test-mcp-tools.mjs            # probe every connector
//   node test-mcp-tools.mjs panos      # probe one connector
//   node test-mcp-tools.mjs --list     # print known connector names
//
// Exit code is non-zero if any probed connector fails a check.
//
// What it asserts, per connector:
//   1. BOOT      - the shipped bundle answers `initialize` + `tools/list` over stdio.
//   2. FLOOR     - tool count has not regressed below the recorded baseline.
//   3. AGREEMENT - any tool whose description starts `DESTRUCTIVE:` or
//                  `VISIBLE-TO-OTHERS:` carries `readOnlyHint: false`, and no tool
//                  is missing `readOnlyHint` entirely. Clients gate unattended
//                  execution on the annotation, never on the prose; a tool that
//                  says DESTRUCTIVE while annotated read-only is a live hazard.
//                  (This is the check whose absence let the panos-mcp regex
//                  classifier ship `readOnlyHint: true` on mutating tools.)
//   4. SHAPE     - every tool has a non-empty description and an object inputSchema.
//
// Enumerating the whole surface, not just the easy part:
//   - A connector whose tools hide behind a `*_navigate` domain step (blumira) is
//     driven through every domain its navigate tool advertises; `tools/list` is
//     re-issued after each and the results are unioned. `blumira_navigate` swaps
//     the listed surface rather than adding to it, so without the union a bare
//     `tools/list` sees 2 of 32 tools.
//   - A Python connector (falcon) is spawned exactly the way plugins/atlas/.mcp.json
//     spawns it (`uv run --project ... python mcp/_env/load.py <module>`), not as
//     `node server.mjs`. It registers its domain modules only after a successful
//     OAuth exchange, so the probe points its base URL at a loopback stub that
//     answers `POST /oauth2/token` and nothing else. That is a local socket on
//     127.0.0.1 owned by this harness - no vendor endpoint, no tenant, no data.
//
// No real credentials are used or needed: annotations are fully observable from
// `tools/list`. The child env is built from scratch (PATH/HOME only) so no
// configured vendor secret in the parent environment can reach a server, and no
// probe can touch a live appliance.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(ROOT, 'plugins/atlas');
const MCP_DIR = resolve(PLUGIN_DIR, 'mcp');
const MCP_CONFIG_FILE = resolve(PLUGIN_DIR, '.mcp.json');
const PROBE_TIMEOUT_MS = 30_000;
// A single navigate/tools-list round trip inside an already-booted session.
const CALL_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Baseline tool-count floors.
//
// OBSERVED VALUES, not targets: every number below was read off a live probe of
// the connectors as plugins/atlas/.mcp.json launches them, on 2026-09-17. A
// connector failing its floor means tools disappeared - usually a build that did
// not re-pack, or a domain that stopped registering.
//
// Counts are of the FULLY ENUMERATED surface: for a navigate-gated connector that
// is the union across every advertised domain, not what a bare `tools/list`
// happens to show.
//
// To re-derive after an intentional tool-surface change:
//   node test-mcp-tools.mjs            # read the "tools" column
// then update the number here in the same commit as the tool change.
// ---------------------------------------------------------------------------
const CONNECTORS = {
  auvik: { floor: 39 },
  blumira: {
    // 2 navigation tools + blumira_back + the five domains' tools, unioned. A bare
    // `tools/list` shows 2: blumira_navigate swaps the listed surface per domain,
    // so the harness navigates all five and unions (see navigate expansion below).
    floor: 32,
  },
  cipp: { floor: 43 },
  connectwise: { floor: 52 },
  falcon: {
    // Python connector: no server.mjs bundle. Spawned exactly as
    // plugins/atlas/.mcp.json spawns it (uv run --project ... python
    // mcp/_env/load.py falcon_mcp.server).
    //
    // falcon registers its 27 domain modules only after FalconClient.authenticate()
    // succeeds; with unusable credentials it drops into "inert mode" and exposes 4
    // diagnostic tools. authStub points FALCON_BASE_URL at a loopback socket that
    // answers the OAuth exchange and nothing else, so the real registration path
    // runs and all 145 tools become observable without any tenant contact.
    floor: 145,
    launch: 'mcp-config',
    authStub: { env: 'FALCON_BASE_URL' },
  },
  knowbe4: { floor: 30 },
  ninjaone: { floor: 45 },
  panos: { floor: 60 },
  paylocity: { floor: 16 },
  spanning: { floor: 14 },
  threatlocker: { floor: 19 },
  typesafe: { floor: 3 },
  vanta: { floor: 28 },
};

// Prose effect markers the connectors use in tool descriptions.
const MARKER = /^(DESTRUCTIVE:|VISIBLE-TO-OTHERS:)/;
// Meta tools every connector exposes even when it has gated itself off. A server
// exposing nothing but these has not really been probed.
const META_TOOL = /_(status|navigate|test_connection|auth_status|sign_in|sign_out)$/;

// ---------------------------------------------------------------------------
// Placeholder credential strategies.
//
// Servers gate `tools/list` on their own "am I configured" check, and they do not
// agree on which env names or value shapes satisfy it. So probe under both
// strategies and keep whichever exposed more tools; a server that answers with
// only its meta tools was never actually opened up.
// ---------------------------------------------------------------------------
const MCP_CONFIG = (() => {
  // The authoritative description of how a connector is launched, and which env
  // names it reads, is the plugin's own .mcp.json - not a guess.
  if (!existsSync(MCP_CONFIG_FILE)) return {};
  return JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf8')).mcpServers || {};
})();

const DECLARED_ENV = Object.fromEntries(
  Object.entries(MCP_CONFIG).map(([name, entry]) => [name, Object.keys(entry.env || {})]),
);

const BLANKET_SUFFIXES = [
  'HOST', 'URL', 'BASE_URL', 'API_KEY', 'KEY', 'TOKEN', 'CLIENT_ID', 'CLIENT_SECRET',
  'SECRET', 'USERNAME', 'PASSWORD', 'TENANT', 'TENANT_ID', 'ACCOUNT_ID', 'COMPANY_ID',
  'PUBLIC_KEY', 'PRIVATE_KEY',
];

function placeholderFor(name) {
  if (/(^|_)HOST$/.test(name)) return 'appliance.example.test';
  if (/URL$/.test(name)) return 'https://example.test';
  if (/VERIFY_TLS$/.test(name)) return 'false';
  return `placeholder-${name.toLowerCase()}`;
}

function envFor(connector, strategy, extra) {
  // Deliberately NOT inheriting process.env: a configured vendor credential must
  // never reach a probed server, or the harness could hit a live appliance.
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: process.env.LANG ?? 'C',
    MCP_TRANSPORT: 'stdio',
    ATLAS_ENV_FILE: '/nonexistent', // suppress .env discovery
  };
  if (strategy === 'declared') {
    for (const key of DECLARED_ENV[connector] || []) {
      if (key === 'MCP_TRANSPORT' || key === 'ATLAS_ENV_FILE') continue;
      const bare = key.replace(/^CFG_/, '');
      const value = placeholderFor(bare);
      env[key] = value;
      env[bare] = value;
    }
  } else {
    const prefix = connector.toUpperCase().replace(/-/g, '_');
    for (const suffix of BLANKET_SUFFIXES) {
      const key = `${prefix}_${suffix}`;
      env[key] = placeholderFor(key);
    }
  }
  // Launcher knobs (never credentials): e.g. which venv `uv run` must reuse.
  return Object.assign(env, extra);
}

// ---------------------------------------------------------------------------
// How to launch a connector.
//
// Node connectors are the shipped bundle under plugins/atlas/mcp/<svc>/server.mjs.
// A connector marked `launch: 'mcp-config'` (falcon: Python, no bundle) is spawned
// with the exact command plugins/atlas/.mcp.json declares for it, so the harness
// cannot drift from how the plugin actually runs it.
// ---------------------------------------------------------------------------
const PREREQ_HINT = {
  uv: 'install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `brew install uv`)',
};
// uv keeps the project venv wherever UV_PROJECT_ENVIRONMENT points. Resolve it
// here so the probe does not silently depend on the parent shell exporting it.
const UV_ENV_NAMES = [...new Set([process.env.UV_PROJECT_ENVIRONMENT, '.venv', '.venv.nosync.noindex'].filter(Boolean))];

function onPath(binary) {
  if (binary.includes('/')) return existsSync(binary) ? binary : null;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = resolve(dir, binary);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function uvProjectEnv(projectDir) {
  for (const name of UV_ENV_NAMES) {
    if (!name) continue; // defensive: an empty UV_PROJECT_ENVIRONMENT export
    if (existsSync(resolve(projectDir, name, 'bin/python'))) return name;
    if (existsSync(resolve(projectDir, name, 'Scripts/python.exe'))) return name;
  }
  return null;
}

function relative(path) {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

function launchFor(connector, spec) {
  if (spec.launch !== 'mcp-config') {
    return { command: process.execPath, args: [resolve(MCP_DIR, connector, 'server.mjs')], env: {} };
  }
  const entry = MCP_CONFIG[connector];
  if (!entry?.command) {
    return { skip: `no "${connector}" server entry in ${relative(MCP_CONFIG_FILE)}, so there is no launch command to probe with` };
  }
  const expand = (s) => s.replaceAll('${CLAUDE_PLUGIN_ROOT}', PLUGIN_DIR);
  const command = expand(entry.command);
  const args = (entry.args || []).map(expand);
  if (!onPath(command)) {
    const hint = PREREQ_HINT[command] ?? `install "${command}" and put it on PATH`;
    return { skip: `missing prerequisite: "${command}" (the launcher ${relative(MCP_CONFIG_FILE)} declares for ${connector}) is not on PATH - ${hint}` };
  }
  const env = {};
  const projectAt = args.indexOf('--project');
  if (basename(command) === 'uv' && projectAt !== -1 && args[projectAt + 1]) {
    const projectDir = args[projectAt + 1];
    const venv = uvProjectEnv(projectDir);
    if (!venv) {
      return {
        skip:
          `missing prerequisite: no Python interpreter in ${relative(projectDir)}/{${UV_ENV_NAMES.join(',')}} ` +
          `- create it with \`uv sync --project ${relative(projectDir)}\``,
      };
    }
    env.UV_PROJECT_ENVIRONMENT = venv;
    // Probe an already-synced env: no lock updates, no network, no surprise
    // 30-second timeout because uv decided to resolve dependencies.
    env.UV_NO_SYNC = '1';
    env.UV_FROZEN = '1';
  }
  return { command, args, env, note: `launched as ${relative(MCP_CONFIG_FILE)} declares: ${basename(command)} ${args.map(relative).join(' ')}` };
}

// ---------------------------------------------------------------------------
// Loopback OAuth stub.
//
// falcon registers its domain modules only after a successful token exchange, so
// a credential-less probe sees 4 diagnostic tools instead of 145. This serves one
// route - POST /oauth2/token - on 127.0.0.1 and refuses everything else, so the
// server's real registration path runs while no vendor endpoint is contacted and
// no tenant data can be returned.
// ---------------------------------------------------------------------------
function startAuthStub() {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    req.resume();
    if (req.method === 'POST' && (req.url ?? '').startsWith('/oauth2/token')) {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'placeholder-token', token_type: 'bearer', expires_in: 1799 }));
      return;
    }
    res.writeHead(501, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: 'test-mcp-tools stub serves the token route only' }] }));
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      res({
        url: `http://127.0.0.1:${server.address().port}`,
        hits,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// MCP stdio probe: spawn, initialize, tools/list, then walk every navigate domain
// and union the listed surfaces.
//
// A `*_navigate` tool either only describes its domains (knowbe4, ninjaone, panos,
// paylocity, spanning, threatlocker, vanta - all of which list everything up
// front) or actually swaps which tools are listed (blumira). Unioning covers
// both: the describe-only case contributes nothing, the gating case contributes
// the tools a bare `tools/list` can never show.
// ---------------------------------------------------------------------------
const NAVIGATE_TOOL = /_navigate$/;

// The domain argument of a navigate tool, as the tool itself declares it: the
// first string property carrying an enum. No hardcoded argument names, and
// nothing is invented - `auvik_navigate` takes a free-form links.next URL rather
// than a domain enum, so it is correctly left uncalled instead of being handed a
// fabricated URL. A connector that hid its surface behind such a free-form
// navigate would still be caught: it would list only meta tools, which the gating
// check below fails unless CONNECTORS records it as known-gated with a reason.
function navigateSteps(tool) {
  const properties = isPlainObject(tool.inputSchema) ? tool.inputSchema.properties : null;
  if (!isPlainObject(properties)) return [];
  for (const [name, schema] of Object.entries(properties)) {
    if (!isPlainObject(schema) || !Array.isArray(schema.enum)) continue;
    const values = schema.enum.filter((v) => typeof v === 'string');
    if (values.length) return values.map((value) => [name, value]);
  }
  return [];
}

async function listTools(connector, strategy, launch, stub) {
  if (launch.command === process.execPath && !existsSync(launch.args[0])) {
    return { connector, strategy, error: `no server.mjs bundle at ${relative(launch.args[0])}` };
  }
  const env = envFor(connector, strategy, launch.env);
  // Point the vendor base URL at the local stub instead of a placeholder host.
  if (stub) env[stub.envName] = stub.url;

  const child = spawn(launch.command, launch.args, { env, stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT });
  const pending = new Map();
  let stderrText = '';
  let buffered = '';
  let dead = null;
  let nextId = 1;

  const abort = (reason) => {
    dead ??= reason;
    for (const waiter of pending.values()) waiter.reject(new Error(reason));
    pending.clear();
  };
  child.stderr.on('data', (d) => { stderrText += d; });
  child.on('error', (e) => abort(`spawn failed: ${e.message}`));
  child.on('exit', (code, signal) => abort(`server exited early (code ${code}, signal ${signal})`));
  child.stdin.on('error', () => { /* server exited before we finished writing */ });
  child.stdout.on('data', (d) => {
    buffered += d;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; } // non-JSON chatter on stdout
      // Notifications (including notifications/tools/list_changed) need no
      // handling: every step below re-issues tools/list explicitly.
      const waiter = msg.id === undefined ? undefined : pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else waiter.resolve(msg.result ?? {});
    }
  });

  const request = (method, params, timeoutMs) => new Promise((ok, no) => {
    if (dead) { no(new Error(dead)); return; }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      no(new Error(`no response to ${method} within ${timeoutMs} ms`));
    }, timeoutMs);
    const settle = (fn) => (value) => { clearTimeout(timer); fn(value); };
    pending.set(id, { resolve: settle(ok), reject: settle(no) });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  try {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-mcp-tools', version: '1' },
    }, PROBE_TIMEOUT_MS);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const base = (await request('tools/list', undefined, PROBE_TIMEOUT_MS)).tools ?? [];

    const union = new Map(base.map((t) => [t.name, t]));
    const navigated = [];
    const navErrors = [];
    for (const nav of base.filter((t) => NAVIGATE_TOOL.test(t.name || ''))) {
      // The probe only ever calls a tool the server itself annotates read-only.
      // A navigate tool that declares readOnlyHint:false is a state change, and
      // enumerating a surface is never worth making one.
      if (annotationOf(nav).readOnlyHint === false) {
        navErrors.push(`${nav.name} not called: annotated readOnlyHint=false, and this probe calls read-only tools only`);
        continue;
      }
      for (const [arg, value] of navigateSteps(nav)) {
        try {
          const call = await request('tools/call', { name: nav.name, arguments: { [arg]: value } }, CALL_TIMEOUT_MS);
          if (call.isError) {
            const text = call.content?.map((c) => c.text).filter(Boolean).join(' ') ?? '';
            navErrors.push(`${nav.name}(${value}) refused: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
            continue;
          }
          const after = (await request('tools/list', undefined, CALL_TIMEOUT_MS)).tools ?? [];
          for (const tool of after) union.set(tool.name, tool);
          navigated.push(value);
        } catch (e) {
          navErrors.push(`${nav.name}(${value}): ${e.message}`);
        }
      }
    }
    return {
      connector,
      strategy,
      tools: [...union.values()],
      baseCount: base.length,
      navigated,
      navErrors,
      stderr: stderrText,
    };
  } catch (e) {
    return {
      connector,
      strategy,
      error: `${e.message}; stderr: ${stderrText.trim().slice(0, 200) || '(empty)'}`,
    };
  } finally {
    try { child.kill(); } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------
// Per-connector evaluation.
// ---------------------------------------------------------------------------
function annotationOf(tool) {
  return (tool && tool.annotations) || {};
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function evaluate(connector, spec) {
  if (spec.skip) {
    return { connector, verdict: 'SKIP', detail: spec.skip, failures: [] };
  }

  // How this connector is launched, and whether its prerequisites are installed.
  // A missing prerequisite is a SKIP that names it and the command to fix it -
  // never a bare "skipped", and never a silent pass.
  const launch = launchFor(connector, spec);
  if (launch.skip) {
    return { connector, verdict: 'SKIP', detail: launch.skip, failures: [] };
  }

  const stub = spec.authStub ? { ...(await startAuthStub()), envName: spec.authStub.env } : null;
  let probes;
  try {
    // Keep whichever placeholder strategy exposed more tools.
    probes = await Promise.all([
      listTools(connector, 'declared', launch, stub),
      listTools(connector, 'blanket', launch, stub),
    ]);
  } finally {
    if (stub) await stub.close();
  }
  const usable = probes.filter((p) => p.tools);
  if (usable.length === 0) {
    return {
      connector,
      verdict: 'FAIL',
      detail: 'BOOT FAILED',
      failures: probes.map((p) => `[${connector}] boot failed (${p.strategy} env): ${p.error}`),
    };
  }
  const best = usable.reduce((a, b) => (b.tools.length > a.tools.length ? b : a));
  const tools = best.tools;
  const failures = [];
  if (stub) {
    const offRoute = stub.hits.filter((h) => !h.startsWith('POST /oauth2/token'));
    if (offRoute.length) {
      failures.push(
        `[${connector}] the loopback stub was asked for more than the token route: ${offRoute.slice(0, 5).join(', ')}.` +
        ` The probe is meant to enumerate tools, not to stand in for the vendor API - check what this server` +
        ` calls during startup.`,
      );
    }
  }

  // 2. FLOOR
  if (tools.length < spec.floor) {
    const rebuild = spec.launch === 'mcp-config'
      ? `the Python project under ${relative(resolve(MCP_DIR, connector))} is out of date - re-sync it with` +
        ` \`uv sync --project ${relative(resolve(MCP_DIR, connector))}\``
      : `the bundle under plugins/atlas/mcp/ is stale - rebuild it with \`npm run build && npm run bundle:atlas\`` +
        ` in mcp_servers/${connector}-mcp (bundle:atlas is what emits server.mjs here; pack:mcpb builds the` +
        ` separate .mcpb desktop archive)`;
    failures.push(
      `[${connector}] tool-count regression: ${tools.length} tools, baseline floor is ${spec.floor}` +
      ` (strategy: ${best.strategy}; navigate domains reached: ${best.navigated.length ? best.navigated.join(', ') : 'none'}).` +
      ` Either a domain stopped registering, or ${rebuild} - or the baseline in test-mcp-tools.mjs needs an` +
      ` intentional update.`,
    );
  }

  // Gating: a server exposing nothing but status/navigate tools was never opened
  // up, so its AGREEMENT result is meaningless - never score that as a pass.
  const exposedOnlyMeta = tools.length > 0 && tools.every((t) => META_TOOL.test(t.name || ''));
  const gated = exposedOnlyMeta || tools.length === 0;
  if (gated && !spec.gated) {
    failures.push(
      `[${connector}] gated off under both placeholder strategies: exposed only ${tools.length} meta tool(s)` +
      ` (${tools.map((t) => t.name).join(', ') || 'none'}) even after navigating ` +
      `${best.navigated.length ? `domains ${best.navigated.join(', ')}` : 'no domains (its navigate tool advertised none, or refused)'}` +
      `${best.navErrors.length ? `; navigate errors: ${best.navErrors.join(' | ')}` : ''}.` +
      ` Its real tools were never listed, so the annotation-agreement check did not actually run. Add a` +
      ` working placeholder env or record it as known-gated in CONNECTORS with a reason.`,
    );
  }

  // 3. AGREEMENT + 4. SHAPE
  const marked = tools.filter((t) => MARKER.test(t.description || ''));
  const annotatedMutating = tools.filter((t) => annotationOf(t).readOnlyHint === false);
  const mismatches = [];
  for (const tool of tools) {
    const ann = annotationOf(tool);
    const description = typeof tool.description === 'string' ? tool.description : '';

    if (!description.trim()) {
      failures.push(`[${connector}] ${tool.name}: empty or missing description`);
    }
    if (!isPlainObject(tool.inputSchema)) {
      failures.push(`[${connector}] ${tool.name}: inputSchema is not an object (got ${JSON.stringify(tool.inputSchema)})`);
    } else if (tool.inputSchema.type !== undefined && tool.inputSchema.type !== 'object') {
      failures.push(`[${connector}] ${tool.name}: inputSchema.type is ${JSON.stringify(tool.inputSchema.type)}, expected "object"`);
    }
    if (typeof ann.readOnlyHint !== 'boolean') {
      failures.push(
        `[${connector}] ${tool.name}: no readOnlyHint annotation at all - an MCP client has no signal ` +
        `for whether this tool may be run unattended`,
      );
    }
    const hit = description.match(MARKER);
    if (hit && ann.readOnlyHint !== false) {
      mismatches.push(tool);
      failures.push(
        `[${connector}] SAFETY-SIGNAL MISMATCH: ${tool.name}\n` +
        `    description marker : ${hit[1]}\n` +
        `    description        : ${description.replace(/\s+/g, ' ').slice(0, 140)}\n` +
        `    annotations        : readOnlyHint=${JSON.stringify(ann.readOnlyHint)}` +
        `, destructiveHint=${JSON.stringify(ann.destructiveHint)}\n` +
        `    expected           : readOnlyHint=false (prose says this tool changes state, so the ` +
        `annotation must not say read-only)`,
      );
    }
  }

  // How the surface was reached, so a reader can tell full enumeration from
  // partial: "42 tools" means nothing without knowing whether all domains opened.
  const expanded = best.navigated.length > 0 && tools.length > best.baseCount;
  const enumeration = expanded
    ? `navigate-expanded: ${best.baseCount} listed + ${tools.length - best.baseCount} behind ${best.navigated.length} domain(s) (${best.navigated.join(', ')})`
    : best.navigated.length
      ? `navigate walked ${best.navigated.length} domain(s); its navigate tool only describes them - all ${tools.length} tools were already listed`
      : 'single tools/list';

  let detail;
  if (failures.length) detail = mismatches.length ? `MISLABELED: ${mismatches.map((t) => t.name).join(', ')}` : 'see failures below';
  else if (gated) detail = spec.gated ?? 'gated';
  else if (marked.length === 0) detail = `ok (no prose effect markers - agreement check vacuous here)${expanded ? `; ${enumeration}` : ''}`;
  else detail = expanded ? `ok (${enumeration})` : 'ok';
  if (!failures.length && best.navErrors.length) {
    detail += `; navigate refused: ${best.navErrors.length}`;
  }

  return {
    connector,
    verdict: failures.length ? 'FAIL' : gated ? `GATED (${tools.length} tools)` : 'PASS',
    strategy: best.strategy,
    tools: tools.length,
    floor: spec.floor,
    marked: marked.length,
    annotatedMutating: annotatedMutating.length,
    mismatches: mismatches.length,
    gated,
    enumeration,
    navigated: best.navigated,
    navErrors: best.navErrors,
    detail,
    failures,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const names = Object.keys(CONNECTORS).sort();

function usage(message) {
  const lines = [];
  if (message) lines.push(`error: ${message}`, '');
  lines.push(
    `usage: node ${basename(fileURLToPath(import.meta.url))} [<svc>]`,
    '',
    '  <svc> omitted   probe every connector below',
    '  <svc> given     probe just that connector',
    '',
    'valid connector names:',
    ...names.map((n) => `  ${n}${CONNECTORS[n].skip ? '   (skipped: ' + CONNECTORS[n].skip + ')' : ''}`),
  );
  return lines.join('\n');
}

const argv = process.argv.slice(2).filter((a) => a !== '--');
if (argv.length > 1) {
  console.error(usage(`expected at most one connector name, got ${argv.length}`));
  process.exit(2);
}
const arg = argv[0];
if (arg === '--help' || arg === '-h') {
  console.log(usage());
  process.exit(0);
}
if (arg === '--list') {
  console.log(names.join('\n'));
  process.exit(0);
}
if (arg !== undefined && !Object.hasOwn(CONNECTORS, arg)) {
  // Surface bundles present on disk but absent from the baseline map: a new
  // connector must be added here or it is never gated.
  const onDisk = existsSync(MCP_DIR)
    ? readdirSync(MCP_DIR).filter((n) => !n.startsWith('_') && statSync(resolve(MCP_DIR, n)).isDirectory())
    : [];
  const unregistered = onDisk.filter((n) => !Object.hasOwn(CONNECTORS, n));
  console.error(usage(`unknown connector "${arg}"`));
  if (unregistered.length) {
    console.error(`\nnote: bundles on disk with no baseline entry: ${unregistered.join(', ')}`);
  }
  process.exit(2);
}

const selected = arg ? [arg] : names;
const results = [];
for (const name of selected) results.push(await evaluate(name, CONNECTORS[name]));

const head = ['connector', 'tools (floor)', 'strategy', 'marked-mutating', 'annotated-mutating', 'mismatch', 'verdict', 'detail'];
const cell = (v) => (v === undefined ? '-' : String(v));
const rows = results.map((r) => [
  r.connector,
  r.tools === undefined ? '-' : `${r.tools} (${r.floor})`,
  r.strategy ?? '-',
  cell(r.marked),
  cell(r.annotatedMutating),
  cell(r.mismatches),
  r.verdict,
  r.detail,
]);
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i] ?? '').length)));
const render = (row) => row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
console.log(render(head));
console.log(widths.map((n) => '-'.repeat(n)).join('  '));
for (const row of rows) console.log(render(row));

const probed = results.filter((r) => r.verdict !== 'SKIP');
const failed = results.filter((r) => r.verdict === 'FAIL');
const gatedList = results.filter((r) => r.gated);
const skippedList = results.filter((r) => r.verdict === 'SKIP');
const enumerated = probed.filter((r) => !r.gated);
const totalTools = probed.reduce((n, r) => n + (r.tools ?? 0), 0);
const totalMismatch = probed.reduce((n, r) => n + (r.mismatches ?? 0), 0);

console.log('');
console.log('COVERAGE');
console.log(
  `  fully enumerated : ${enumerated.length}/${results.length} connector(s), ${totalTools} tools` +
  `${enumerated.length ? ' - every tool these connectors can register was listed and checked' : ''}`,
);
for (const r of enumerated.filter((r) => r.navigated?.length)) {
  console.log(`      ${r.connector}: ${r.enumeration}`);
}
console.log(`  gated            : ${gatedList.length}${gatedList.length ? '' : ' - none'}`);
for (const r of gatedList) {
  console.log(`      ${r.connector}: only ${r.tools} tool(s) observable - ${r.detail}`);
}
console.log(`  skipped          : ${skippedList.length}${skippedList.length ? '' : ' - none'}`);
for (const r of skippedList) {
  console.log(`      ${r.connector}: ${r.detail}`);
}
console.log(
  gatedList.length || skippedList.length
    ? '  NOTE: gated and skipped connectors are NOT covered by the checks below.'
    : '  no connector escaped the checks below.',
);
console.log('');
console.log(`safety-signal mismatches (prose says mutating, annotation says read-only): ${totalMismatch}`);

if (failed.length) {
  console.log('');
  console.log('FAILURES');
  for (const r of failed) for (const f of r.failures) console.log(`  ${f}`);
  console.log('');
  console.log(`FAIL: ${failed.length}/${probed.length} probed connector(s) failed: ${failed.map((r) => r.connector).join(', ')}`);
  process.exit(1);
}
console.log('');
console.log(
  probed.length === 0
    ? 'PASS (nothing probed): every selected connector was skipped'
    : `PASS: ${probed.length} connector(s) booted and passed boot, tool-count floor, prose/annotation agreement,` +
      ` and tool-shape checks - ${enumerated.length} fully enumerated (${totalTools} tools),` +
      ` ${gatedList.length} gated, ${skippedList.length} skipped`,
);
