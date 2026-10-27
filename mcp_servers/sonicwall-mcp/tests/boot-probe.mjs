// Boot probe for the bundled sonicwall server (proof-first: written before server.ts).
// Drives plugins/armada/mcp/sonicwall/server.mjs over MCP stdio exactly the way
// plugins/armada/.mcp.json launches it: `node --import _env/load.mjs server.mjs`,
// so CFG_SONICWALL_* translation is exercised, not bypassed.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_MCP = resolvePath(HERE, '../../../plugins/armada/mcp');
const SERVER = resolvePath(PLUGIN_MCP, 'sonicwall/server.mjs');
const ENV_LOADER = resolvePath(PLUGIN_MCP, '_env/load.mjs');

/**
 * Spawn the bundle, handshake, list tools, then run `calls` (tools/call) in order.
 * Resolves { tools, results: { [name-or-label]: text }, stderr }.
 */
function probe(label, env, calls = []) {
  return new Promise((resolve, reject) => {
    const merged = { ...process.env, MCP_TRANSPORT: 'stdio', ...env };
    for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
    const child = spawn('node', ['--import', ENV_LOADER, SERVER], { env: merged, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label}: timed out. stderr: ${stderr.slice(0, 500)}`));
    }, 30000);
    child.stderr.on('data', (d) => { stderr += d; });
    let tools = null;
    const results = [];
    const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    child.on('exit', (code) => {
      if (tools === null) { clearTimeout(timer); reject(new Error(`${label}: server exited ${code} before tools/list. stderr: ${stderr.slice(0, 500)}`)); }
    });
    child.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list' });
        } else if (msg.id === 2) {
          tools = msg.result.tools;
          if (calls.length === 0) { clearTimeout(timer); child.kill(); resolve({ tools, results, stderr }); return; }
          send({ id: 10, method: 'tools/call', params: calls[0] });
        } else if (msg.id >= 10) {
          const text = (msg.result?.content ?? []).map((c) => c.text ?? '').join('\n');
          results.push({ name: calls[msg.id - 10].name, text, isError: msg.result?.isError === true, error: msg.error });
          if (msg.id - 10 + 1 < calls.length) send({ id: msg.id + 1, method: 'tools/call', params: calls[msg.id - 10 + 1] });
          else { clearTimeout(timer); child.kill(); resolve({ tools, results, stderr }); }
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } });
  });
}

// Fake credential, built at runtime so no literal looks like a real secret.
// Long and varied so 6+ char prefixes exist to hunt for in sonicwall_status.
const FAKE_PASSWORD = ['Zx9', 'Qm4', 'Lw2', 'Rt8', 'Vb6', 'Kd3'].join('-');
// Loopback port 1: connection refused immediately, so no packet leaves the machine.
const UNREACHABLE = { HOST: '127.0.0.1', PORT: '1' };

const NAMES = ['HOST', 'USERNAME', 'PASSWORD', 'PORT', 'VERIFY_TLS', 'SESSION_OVERRIDE'];
// The loader reads ~/.config/atlas/atlas.env and ~/.claude/settings.json through homedir(),
// so a throwaway HOME keeps a developer's real credentials out of every case.
const PROBE_HOME = mkdtempSync(join(tmpdir(), 'probe-home-'));
process.on('exit', () => rmSync(PROBE_HOME, { recursive: true, force: true }));
const CLEAN = { HOME: PROBE_HOME, ATLAS_ENV_FILE: resolvePath(HERE, 'no-such-env-file') };
for (const n of NAMES) { CLEAN[`SONICWALL_${n}`] = ''; CLEAN[`CFG_SONICWALL_${n}`] = ''; }
const bare = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`SONICWALL_${k}`, v]));
const cfg = (o) => ({
  ...Object.fromEntries(NAMES.map((n) => [`SONICWALL_${n}`, undefined])),
  ...Object.fromEntries(Object.entries(o).map(([k, v]) => [`CFG_SONICWALL_${k}`, v])),
});

const FULL = { ...UNREACHABLE, USERNAME: 'api-admin', PASSWORD: FAKE_PASSWORD };
const cases = [
  ['no credentials', { ...CLEAN }],
  ['host only', { ...CLEAN, ...bare({ HOST: UNREACHABLE.HOST }) }],
  ['host + username, no password', { ...CLEAN, ...bare({ HOST: UNREACHABLE.HOST, USERNAME: 'api-admin' }) }],
  ['host + username + password (full)', { ...CLEAN, ...bare(FULL) }],
  ['unresolved MCP placeholders', { ...CLEAN, ...bare({ HOST: '${user_config.sonicwall_host}', USERNAME: '${user_config.sonicwall_username}', PASSWORD: '${user_config.sonicwall_password}' }) }],
  ['CFG_ only, as .mcp.json injects them', { ...CLEAN, ...cfg(FULL) }],
  ['CFG_ unresolved placeholders', { ...CLEAN, ...cfg({ HOST: '${user_config.sonicwall_host}', USERNAME: '${user_config.sonicwall_username}', PASSWORD: '${user_config.sonicwall_password}' }) }],
];

// Exact counts per credential state: a state that quietly gains or drops a tool is a disclosure bug.
const FULL_COUNT = 41;
const EXPECTED_TOOLS = {
  'no credentials': 2,
  'host only': 2,
  'host + username, no password': 2,
  'host + username + password (full)': FULL_COUNT,
  'unresolved MCP placeholders': 2,
  'CFG_ only, as .mcp.json injects them': FULL_COUNT,
  'CFG_ unresolved placeholders': 2,
};
const EXPECTED_DESTRUCTIVE_PREFIXED = 11;
// Not read-only, deliberately unprefixed; all four flags pinned.
const UNPREFIXED_MUTATING = {
  sonicwall_request: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
};
const BARE = ['sonicwall_navigate', 'sonicwall_status'];

let failures = 0;
const fail = (msg) => { console.log(`  ${msg}`); failures++; };

for (const [label, env] of cases) {
  const full = EXPECTED_TOOLS[label] === FULL_COUNT;
  const calls = [{ name: 'sonicwall_status', arguments: {} }];
  if (full) {
    calls.push(
      { name: 'sonicwall_request', arguments: { method: 'POST', path: '/restart-sonicos', confirm: true } },
      { name: 'sonicwall_request', arguments: { method: 'GET', path: '/export/current-config' } },
      { name: 'sonicwall_request', arguments: { method: 'DELETE', path: '/address-objects/all-ipv4', confirm: true } },
      { name: 'sonicwall_request', arguments: { method: 'GET', path: '/no/such/sonicos/path' } },
      { name: 'sonicwall_request', arguments: { method: 'POST', path: '/config/pending' } },
      { name: 'sonicwall_policies_update', arguments: { resource: 'access-rules/ipv4', uuid: '0123', body: {}, patch: true } },
    );
  }
  const { tools, results } = await probe(label, env, calls);
  const names = tools.map((t) => t.name).sort();
  const prefixed = tools.filter((t) => t.description.startsWith('DESTRUCTIVE:')).length;
  console.log(`\n[${label}] ${tools.length} tools, ${prefixed} DESTRUCTIVE:-prefixed`);
  console.log('  ' + names.join(', '));
  if (tools.length !== EXPECTED_TOOLS[label]) fail(`TOOL COUNT CHANGED: expected ${EXPECTED_TOOLS[label]}, got ${tools.length}`);
  if (!full && JSON.stringify(names) !== JSON.stringify(BARE)) fail(`bare state must list exactly ${BARE.join(', ')}`);
  if (label.startsWith('CFG_ only') && tools.length < FULL_COUNT) fail('CFG_ TRANSLATION BROKEN: the plugin path never reaches the full tool set');
  if (label === 'CFG_ unresolved placeholders' && tools.length !== 2) fail('UNRESOLVED CFG_ PLACEHOLDERS LEAKED THROUGH as a real host');

  // ---- sonicwall_status: runs in every state, never echoes the password ----
  const statusText = results[0]?.text ?? '';
  if (!statusText.includes('SonicWall MCP Server Status')) fail('sonicwall_status DID NOT RUN in this credential state');
  const pwLine = statusText.split('\n').find((l) => l.startsWith('SONICWALL_PASSWORD:')) ?? '(absent)';
  console.log(`  status password line: ${pwLine}`);
  const configured = env.SONICWALL_PASSWORD || env.CFG_SONICWALL_PASSWORD || '';
  if (configured && !configured.startsWith('${')) {
    const leaked = [];
    for (let n = 6; n <= configured.length; n++) if (statusText.includes(configured.slice(0, n))) leaked.push(n);
    if (leaked.length) fail(`PASSWORD FRAGMENT LEAKED by sonicwall_status (prefix lengths ${leaked.join(', ')})`);
    if (pwLine !== `SONICWALL_PASSWORD: configured (${configured.length} chars)`) fail('status must report the password as configured plus its length');
  } else if (pwLine !== 'SONICWALL_PASSWORD: not set') fail('status must report an absent/unresolved password as "not set"');

  // ---- annotation agreement, both directions ----
  let readClass = 0, mutatingClass = 0, unprefixedMutating = 0;
  for (const t of tools) {
    const isPrefixed = t.description.startsWith('DESTRUCTIVE:');
    const a = t.annotations ?? {};
    const flags = `readOnlyHint=${a.readOnlyHint}, destructiveHint=${a.destructiveHint}`;
    if (a.readOnlyHint === undefined || a.destructiveHint === undefined) { fail(`UNANNOTATED TOOL: ${t.name} (${flags})`); continue; }
    if (isPrefixed) {
      mutatingClass++;
      if (a.readOnlyHint !== false || a.destructiveHint !== true) fail(`ANNOTATION CONTRADICTS "DESTRUCTIVE:" PREFIX: ${t.name} (${flags})`);
    } else if (Object.hasOwn(UNPREFIXED_MUTATING, t.name)) {
      unprefixedMutating++;
      const want = UNPREFIXED_MUTATING[t.name];
      const got = Object.fromEntries(Object.keys(want).map((k) => [k, a[k]]));
      if (JSON.stringify(got) !== JSON.stringify(want)) fail(`UNPREFIXED TOOL ANNOTATIONS DRIFTED: ${t.name} expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    } else {
      readClass++;
      if (a.readOnlyHint !== true || a.destructiveHint !== false) fail(`READ TOOL ANNOTATED MUTATING (no "DESTRUCTIVE:" prefix): ${t.name} (${flags})`);
    }
  }
  console.log(`  annotation classes: read=${readClass}, mutating=${mutatingClass}, unprefixed-mutating=${unprefixedMutating}`);
  if (mutatingClass !== prefixed) fail(`CLASS COUNT DRIFT: ${prefixed} prefixed but ${mutatingClass} classed mutating`);

  if (!full) continue;
  if (prefixed !== EXPECTED_DESTRUCTIVE_PREFIXED) fail(`DESTRUCTIVE PREFIX COUNT CHANGED: expected ${EXPECTED_DESTRUCTIVE_PREFIXED}`);
  const by = (n) => tools.find((t) => t.name === n);

  // Safety rules 2 and 3.
  for (const n of ['sonicwall_objects_create', 'sonicwall_objects_update', 'sonicwall_objects_delete',
    'sonicwall_policies_create', 'sonicwall_policies_update', 'sonicwall_policies_delete']) {
    const t = by(n);
    if (!t) { fail(`MISSING TOOL: ${n}`); continue; }
    if (!t.description.startsWith('DESTRUCTIVE:')) fail(`NOT MARKED DESTRUCTIVE: ${n}`);
    if (!t.description.includes('sonicwall_config_commit')) fail(`${n} description must name sonicwall_config_commit (writes are staged)`);
  }
  for (const n of ['sonicwall_config_commit', 'sonicwall_logout', 'sonicwall_config_discard', 'sonicwall_config_mode', 'sonicwall_non_config_mode']) {
    if (!by(n)?.description.startsWith('DESTRUCTIVE:')) fail(`NOT MARKED DESTRUCTIVE: ${n}`);
  }
  if (!by('sonicwall_config_commit')?.description.includes('VISIBLE-TO-OTHERS:')) fail('sonicwall_config_commit must be marked VISIBLE-TO-OTHERS:');
  if (!by('sonicwall_config_mode')?.description.includes('VISIBLE-TO-OTHERS:')) fail('sonicwall_config_mode must be marked VISIBLE-TO-OTHERS:');
  for (const n of ['sonicwall_config_pending', 'sonicwall_version', 'sonicwall_objects_list', 'sonicwall_policies_get', 'sonicwall_log_view']) {
    if (by(n)?.description.startsWith('DESTRUCTIVE:')) fail(`READ TOOL WRONGLY MARKED DESTRUCTIVE: ${n}`);
  }
  if (!by('sonicwall_request')?.description.trim().endsWith('Do not compose a path from memory.')) fail('sonicwall_request description must end with the grounding instruction');
  if (!by('sonicwall_request')?.description.includes('sonicwall_navigate')) fail('sonicwall_request description must point at sonicwall_navigate');

  // ---- sonicwall_request guard: rejected locally, no network call ----
  // The host is loopback port 1. A transport failure here would mean the guard
  // let the request through to fetch; the guard error must be what comes back.
  const [, hard1, hard2, hard3, unlisted, noConfirm, patchAr] = results;
  const guardCases = [
    ['hard-deny /restart-sonicos (confirm:true)', hard1, 'hard-denied'],
    ['hard-deny /export/current-config', hard2, 'hard-denied'],
    ['hard-deny delete-all endpoint (confirm:true)', hard3, 'hard-denied'],
    ['unlisted path', unlisted, 'not in the SonicOS endpoint inventory'],
    ['non-GET without confirm', noConfirm, 'confirm'],
  ];
  for (const [what, r, needle] of guardCases) {
    const text = r?.text ?? '';
    const ok = r?.isError === true && text.includes(needle) && !/ECONNREFUSED|fetch failed|transport|SONICWALL_HOST/i.test(text);
    console.log(`  guard ${what}: ${ok ? 'rejected locally' : 'FAILED'}`);
    if (!ok) fail(`sonicwall_request guard must reject "${what}" locally with "${needle}" and no transport error; got: ${text.slice(0, 200)}`);
  }
  const patchOk = patchAr?.isError === true && /PATCH/.test(patchAr.text) && !/ECONNREFUSED|fetch failed/i.test(patchAr.text);
  console.log(`  guard access-rules patch:true: ${patchOk ? 'rejected locally' : 'FAILED'}`);
  if (!patchOk) fail('policies update with patch:true on access-rules must be rejected locally');
}

console.log(failures === 0 ? '\nPROBE PASS' : `\nPROBE FAIL: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
