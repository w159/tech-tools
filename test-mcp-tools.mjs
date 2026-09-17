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
// No real credentials are used or needed: annotations are fully observable from
// `tools/list`. The child env is built from scratch (PATH/HOME only) so no
// configured vendor secret in the parent environment can reach a server, and no
// probe can touch a live appliance.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = resolve(ROOT, 'plugins/atlas/mcp');
const PROBE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Baseline tool-count floors.
//
// OBSERVED VALUES, not targets: every number below was read off a live probe of
// the shipped bundles in plugins/atlas/mcp/ on 2026-09-17. A connector failing
// its floor means tools disappeared from the bundle - usually a build that did
// not re-pack, or a domain that stopped registering.
//
// To re-derive after an intentional tool-surface change:
//   node test-mcp-tools.mjs            # read the "tools" column
// then update the number here in the same commit as the tool change.
// ---------------------------------------------------------------------------
const CONNECTORS = {
  auvik: { floor: 39 },
  blumira: {
    floor: 2,
    // blumira_navigate + blumira_status are the whole listed surface: the rest of
    // the vendor's tools are registered only after a `blumira_navigate` domain
    // selection, so a credential-less `tools/list` can never see them. Known and
    // expected - recorded here so it reads as GATED rather than as a clean pass
    // on 2 tools or as a boot failure.
    gated: 'remaining tools register behind a blumira_navigate domain step',
  },
  cipp: { floor: 43 },
  connectwise: { floor: 52 },
  falcon: { skip: 'python connector - ships no server.mjs bundle (see mcp_servers/falcon-mcp)' },
  knowbe4: { floor: 30 },
  ninjaone: { floor: 45 },
  panos: { floor: 60 },
  paylocity: { floor: 16 },
  spanning: { floor: 14 },
  threatlocker: { floor: 19 },
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
const DECLARED_ENV = (() => {
  // The authoritative list of env names a connector reads is the plugin's own
  // .mcp.json env block, not a guess.
  const file = resolve(ROOT, 'plugins/atlas/.mcp.json');
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Object.fromEntries(
    Object.entries(parsed.mcpServers || {}).map(([k, v]) => [k, Object.keys(v.env || {})]),
  );
})();

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

function envFor(connector, strategy) {
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
  return env;
}

// ---------------------------------------------------------------------------
// MCP stdio probe: spawn, initialize, notifications/initialized, tools/list.
// ---------------------------------------------------------------------------
function listTools(connector, strategy) {
  const server = resolve(MCP_DIR, connector, 'server.mjs');
  if (!existsSync(server)) {
    return Promise.resolve({ connector, strategy, error: 'no server.mjs bundle at ' + `plugins/atlas/mcp/${connector}/server.mjs` });
  }
  return new Promise((res) => {
    const child = spawn(process.execPath, [server], {
      env: envFor(connector, strategy),
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: ROOT,
    });
    let out = '';
    let err = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      res(value);
    };
    const timer = setTimeout(
      () => done({ connector, strategy, error: `no tools/list response within ${PROBE_TIMEOUT_MS} ms; stderr: ${err.trim().slice(0, 200) || '(empty)'}` }),
      PROBE_TIMEOUT_MS,
    );
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => {
      out += d;
      const lines = out.split('\n');
      out = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) {
            done({ connector, strategy, error: `initialize failed: ${msg.error.message ?? JSON.stringify(msg.error)}` });
            return;
          }
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
        }
        if (msg.id === 2) {
          if (msg.error) {
            done({ connector, strategy, error: `tools/list failed: ${msg.error.message ?? JSON.stringify(msg.error)}` });
            return;
          }
          done({ connector, strategy, tools: msg.result?.tools ?? [], stderr: err });
        }
      }
    });
    child.on('error', (e) => done({ connector, strategy, error: `spawn failed: ${e.message}` }));
    child.stdin.on('error', () => { /* server exited before we finished writing */ });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-mcp-tools', version: '1' } },
    })}\n`);
  });
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

  // Keep whichever placeholder strategy exposed more tools.
  const probes = await Promise.all([listTools(connector, 'declared'), listTools(connector, 'blanket')]);
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

  // 2. FLOOR
  if (tools.length < spec.floor) {
    failures.push(
      `[${connector}] tool-count regression: ${tools.length} tools, baseline floor is ${spec.floor}` +
      ` (strategy: ${best.strategy}). Either a domain stopped registering, or the bundle under` +
      ` plugins/atlas/mcp/ is stale - rebuild it with \`npm run build && npm run bundle:atlas\` in` +
      ` mcp_servers/${connector}-mcp (bundle:atlas is what emits server.mjs here; pack:mcpb builds the` +
      ` separate .mcpb desktop archive) - or the baseline in test-mcp-tools.mjs needs an intentional update.`,
    );
  }

  // Gating: a server exposing nothing but status/navigate tools was never opened
  // up, so its AGREEMENT result is meaningless - never score that as a pass.
  const exposedOnlyMeta = tools.length > 0 && tools.every((t) => META_TOOL.test(t.name || ''));
  const gated = exposedOnlyMeta || tools.length === 0;
  if (gated && !spec.gated) {
    failures.push(
      `[${connector}] gated off under both placeholder strategies: exposed only ${tools.length} meta tool(s)` +
      ` (${tools.map((t) => t.name).join(', ') || 'none'}). Its real tools were never listed, so the` +
      ` annotation-agreement check did not actually run. Add a working placeholder env or record it as` +
      ` known-gated in CONNECTORS with a reason.`,
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

  let detail;
  if (failures.length) detail = mismatches.length ? `MISLABELED: ${mismatches.map((t) => t.name).join(', ')}` : 'see failures below';
  else if (gated) detail = spec.gated;
  else if (marked.length === 0) detail = 'ok (no prose effect markers - agreement check vacuous here)';
  else detail = 'ok';

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
const totalTools = probed.reduce((n, r) => n + (r.tools ?? 0), 0);
const totalMismatch = probed.reduce((n, r) => n + (r.mismatches ?? 0), 0);

console.log('');
console.log(`fleet: ${totalTools} tools across ${probed.length} probed connector(s); ${results.length - probed.length} skipped`);
console.log(`safety-signal mismatches (prose says mutating, annotation says read-only): ${totalMismatch}`);
if (gatedList.length) {
  console.log(`gated (tool surface not fully observable with placeholder credentials): ${gatedList.map((r) => `${r.connector} (${r.tools})`).join(', ')}`);
}

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
    : `PASS: ${probed.length} connector(s) booted and passed boot, tool-count floor, prose/annotation agreement, and tool-shape checks`,
);
