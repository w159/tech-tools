// Boot probe for the bundled typesafe server: MCP stdio handshake, then
// tools/list, then tools/call in every credential state. Mirrors
// mcp_servers/panos-mcp/tests/boot-probe.mjs's shape, simplified for a flat
// 3-tool server with no progressive tool-list disclosure: typesafe_status,
// typesafe_decide, and typesafe_list_models are ALWAYS listed, in every
// credential state.
//
// No real credentials are used or needed, and no vendor endpoint is ever
// contacted: TYPESAFE_BASE_URL / OPENROUTER_BASE_URL are pointed at an
// unroutable local port (127.0.0.1:1, which refuses every connection) in
// every "credentials present" case, so a typesafe_decide / typesafe_list_models
// call that reaches the network hop fails fast and locally
// (ECONNREFUSED -> NETWORK_ERROR) instead of making a live call to
// api.typesafe.ai or openrouter.ai.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_MCP = resolvePath(HERE, '../../../plugins/atlas/mcp');
const SERVER = resolvePath(PLUGIN_MCP, 'typesafe/server.mjs');
const ENV_LOADER = resolvePath(PLUGIN_MCP, '_env/load.mjs');
const UNROUTABLE_BASE_URL = 'http://127.0.0.1:1';

function probe(label, env) {
  return new Promise((resolve, reject) => {
    const merged = { ...process.env, MCP_TRANSPORT: 'stdio', ...env };
    for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
    const child = spawn('node', ['--import', ENV_LOADER, SERVER], {
      env: merged,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label}: timed out. stderr: ${stderr.slice(0, 500)}`));
    }, 15000);

    child.stderr.on('data', (d) => { stderr += d; });
    let tools = null;
    let statusText = null;
    let decideResult = null;
    let modelsResult = null;
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
        }
        if (msg.id === 2) {
          tools = msg.result.tools;
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 3, method: 'tools/call',
            params: { name: 'typesafe_status', arguments: {} },
          }) + '\n');
        }
        if (msg.id === 3) {
          statusText = (msg.result?.content ?? []).map((c) => c.text ?? '').join('\n');
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 4, method: 'tools/call',
            params: { name: 'typesafe_decide', arguments: { state: 'a ticket', questions: { q1: { type: 'noul', instructions: 'is this urgent?' } } } },
          }) + '\n');
        }
        if (msg.id === 4) {
          decideResult = msg.result;
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 5, method: 'tools/call',
            params: { name: 'typesafe_list_models', arguments: {} },
          }) + '\n');
        }
        if (msg.id === 5) {
          modelsResult = msg.result;
          clearTimeout(timer);
          child.kill();
          resolve({ label, tools, statusText, decideResult, modelsResult, stderr });
        }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
    }) + '\n');
  });
}

// ATLAS_ENV_FILE is pointed at a path that does not exist so the loader falls
// through to the CFG_ translation instead of reading a developer's real .env.
const CLEAN = {
  ATLAS_ENV_FILE: resolvePath(HERE, 'no-such-env-file'),
  TYPESAFE_API_KEY: '', TYPESAFE_BASE_URL: '', OPENROUTER_API_KEY: '', OPENROUTER_BASE_URL: '',
  TYPESAFE_PROVIDER: '', TYPESAFE_MODEL: '',
  CFG_TYPESAFE_API_KEY: '', CFG_TYPESAFE_BASE_URL: '', CFG_OPENROUTER_API_KEY: '', CFG_OPENROUTER_BASE_URL: '',
  CFG_TYPESAFE_PROVIDER: '', CFG_TYPESAFE_MODEL: '',
};

// Shaped like a real key so the no-leak assertion below has 6+ character
// prefixes to hunt for. Never a real credential.
const FAKE_TYPESAFE_KEY = 'ts-fakekeynotreal0123456789abcdef';
const FAKE_OPENROUTER_KEY = 'sk-or-fakekeynotreal0123456789abcdef';

// `credentialed: true` cases carry a fake key, so their base URLs are also
// pointed at the unroutable local port below - never real, never optional.
const cases = [
  ['no credentials', { ...CLEAN }, false],
  ['typesafe key only', { ...CLEAN, TYPESAFE_API_KEY: FAKE_TYPESAFE_KEY, TYPESAFE_BASE_URL: UNROUTABLE_BASE_URL }, true],
  ['openrouter key only', { ...CLEAN, OPENROUTER_API_KEY: FAKE_OPENROUTER_KEY, OPENROUTER_BASE_URL: UNROUTABLE_BASE_URL }, true],
  ['both keys, explicit provider=openrouter', { ...CLEAN, TYPESAFE_API_KEY: FAKE_TYPESAFE_KEY, OPENROUTER_API_KEY: FAKE_OPENROUTER_KEY, OPENROUTER_BASE_URL: UNROUTABLE_BASE_URL, TYPESAFE_PROVIDER: 'openrouter' }, true],
  ['explicit provider=openrouter, no openrouter key (misconfigured)', { ...CLEAN, TYPESAFE_API_KEY: FAKE_TYPESAFE_KEY, TYPESAFE_PROVIDER: 'openrouter' }, false],
  ['unresolved MCP placeholders', { ...CLEAN, TYPESAFE_API_KEY: '${user_config.typesafe_api_key}', OPENROUTER_API_KEY: '${user_config.typesafe_openrouter_api_key}' }, false],
  // The path the plugin actually takes: the MCP host injects CFG_ names only.
  ['CFG_ only, as .mcp.json injects them (typesafe)', { ...CLEAN, TYPESAFE_API_KEY: undefined, TYPESAFE_BASE_URL: undefined, CFG_TYPESAFE_API_KEY: FAKE_TYPESAFE_KEY, CFG_TYPESAFE_BASE_URL: UNROUTABLE_BASE_URL }, true],
  ['CFG_ only, as .mcp.json injects them (openrouter)', { ...CLEAN, OPENROUTER_API_KEY: undefined, OPENROUTER_BASE_URL: undefined, CFG_OPENROUTER_API_KEY: FAKE_OPENROUTER_KEY, CFG_OPENROUTER_BASE_URL: UNROUTABLE_BASE_URL }, true],
];

// Every case exposes exactly 3 tools: no progressive disclosure in this
// connector (see docs/typesafe-connector-design.md). A state that gains or
// drops a tool here is a real regression, not an intentional gate.
const EXPECTED_TOOL_COUNT = 3;
const EXPECTED_TOOL_NAMES = ['typesafe_decide', 'typesafe_list_models', 'typesafe_status'];

let failures = 0;
for (const [label, env, credentialed] of cases) {
  const { tools, statusText, decideResult, modelsResult } = await probe(label, env);
  const names = tools.map((t) => t.name).sort();
  console.log(`\n[${label}] ${tools.length} tools`);
  console.log('  ' + names.join(', '));

  if (tools.length !== EXPECTED_TOOL_COUNT) {
    console.log(`  TOOL COUNT CHANGED: expected ${EXPECTED_TOOL_COUNT} (flat list, no progressive disclosure)`);
    failures++;
  }
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_TOOL_NAMES)) {
    console.log(`  TOOL NAMES CHANGED: expected ${JSON.stringify(EXPECTED_TOOL_NAMES)}`);
    failures++;
  }

  // ---- annotation shape: all three tools must be read-only, in every state.
  for (const t of tools) {
    const a = t.annotations ?? {};
    if (a.readOnlyHint !== true || a.destructiveHint !== false) {
      console.log(`  TOOL NOT ANNOTATED READ-ONLY: ${t.name} (readOnlyHint=${a.readOnlyHint}, destructiveHint=${a.destructiveHint})`);
      failures++;
    }
    if (!t.description || t.description.trim().length === 0) {
      console.log(`  EMPTY DESCRIPTION: ${t.name}`);
      failures++;
    }
    if (typeof t.inputSchema !== 'object' || t.inputSchema === null || t.inputSchema.type !== 'object') {
      console.log(`  BAD INPUT SCHEMA SHAPE: ${t.name}`);
      failures++;
    }
  }

  // ---- typesafe_status must always run, and must never leak a key fragment.
  if (!statusText || !statusText.includes('TypeSafe (Jev) MCP Server Status')) {
    console.log('  typesafe_status DID NOT RUN in this credential state');
    failures++;
  }
  const configuredKeys = [env.TYPESAFE_API_KEY || env.CFG_TYPESAFE_API_KEY, env.OPENROUTER_API_KEY || env.CFG_OPENROUTER_API_KEY].filter(
    (k) => k && !k.startsWith('${')
  );
  for (const key of configuredKeys) {
    const leaked = [];
    for (let n = 6; n <= key.length; n++) {
      if (statusText.includes(key.slice(0, n))) leaked.push(n);
    }
    if (leaked.length) {
      console.log(`  API KEY FRAGMENT LEAKED by typesafe_status (prefix lengths ${leaked.join(', ')})`);
      failures++;
    }
  }

  // ---- typesafe_decide / typesafe_list_models tools/call results.
  const decideText = (decideResult?.content ?? []).map((c) => c.text ?? '').join('\n');
  const modelsText = (modelsResult?.content ?? []).map((c) => c.text ?? '').join('\n');
  if (!credentialed) {
    // Every one of these cases throws MISSING_CREDENTIALS before any fetch
    // (see node-typesafe tests/client.test.ts "throws MISSING_CREDENTIALS ...
    // before any fetch"), so it is safe to assert the exact envelope.
    if (!decideResult?.isError || !decideText.includes('MISSING_CREDENTIALS')) {
      console.log(`  typesafe_decide should report MISSING_CREDENTIALS: ${decideText.slice(0, 200)}`);
      failures++;
    }
    if (!modelsResult?.isError || !modelsText.includes('MISSING_CREDENTIALS')) {
      console.log(`  typesafe_list_models should report MISSING_CREDENTIALS: ${modelsText.slice(0, 200)}`);
      failures++;
    }
    if (label.startsWith('explicit provider=openrouter, no openrouter key')) {
      if (!decideText.includes('OPENROUTER_API_KEY')) {
        console.log('  explicit-provider misconfiguration must name OPENROUTER_API_KEY specifically');
        failures++;
      }
    } else {
      if (!decideText.includes('TYPESAFE_API_KEY') || !decideText.includes('OPENROUTER_API_KEY')) {
        console.log('  unresolved-provider MISSING_CREDENTIALS must name BOTH TYPESAFE_API_KEY and OPENROUTER_API_KEY');
        failures++;
      }
    }
  } else {
    // A resolved provider pointed at an unroutable local port fails at the
    // network hop, never MISSING_CREDENTIALS - proves the request reached
    // past credential resolution without ever touching a real vendor endpoint.
    if (decideResult?.isError && decideText.includes('MISSING_CREDENTIALS')) {
      console.log(`  typesafe_decide reported MISSING_CREDENTIALS despite a configured key: ${decideText.slice(0, 200)}`);
      failures++;
    }
    if (!decideResult?.isError || !decideText.includes('NETWORK_ERROR')) {
      console.log(`  typesafe_decide against an unroutable base URL should fail with NETWORK_ERROR: ${decideText.slice(0, 200)}`);
      failures++;
    }
  }
}

console.log(failures === 0 ? '\nPROBE PASS' : `\nPROBE FAIL: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
