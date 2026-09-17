// Boot probe for the bundled panos server: MCP stdio handshake, then tools/list.
// AGENTS.md:95 names test-mcp-tools.mjs for this; that harness is absent from the
// tree, so this does the same job directly against the bundle.
import { spawn } from 'node:child_process';

import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_MCP = resolvePath(HERE, '../../../plugins/atlas/mcp');
const SERVER = resolvePath(PLUGIN_MCP, 'panos/server.mjs');
const ENV_LOADER = resolvePath(PLUGIN_MCP, '_env/load.mjs');

/**
 * Spawn exactly the way plugins/atlas/.mcp.json does: `node --import
 * <_env/load.mjs> <server.mjs>`. The loader is what turns the `CFG_PANOS_*`
 * values the MCP host injects into the bare `PANOS_*` names the server reads,
 * so probing the server directly would skip the step most likely to be wrong.
 */
function probe(label, env) {
  return new Promise((resolve, reject) => {
    // Drop undefined keys so a case can genuinely unset a variable rather than
    // handing spawn the string "undefined".
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
          // panos_status is the one tool registered in every credential state,
          // so its rendered output is probeable without an appliance - which
          // is what keeps the "no part of the key is printed" rule testable.
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0', id: 3, method: 'tools/call',
            params: { name: 'panos_status', arguments: {} },
          }) + '\n');
        }
        if (msg.id === 3) {
          clearTimeout(timer);
          child.kill();
          const statusText = (msg.result?.content ?? []).map((c) => c.text ?? '').join('\n');
          resolve({ label, tools, statusText, stderr });
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
  PANOS_HOST: '', PANOS_API_KEY: '', PANOS_USERNAME: '', PANOS_PASSWORD: '',
  PANOS_TARGET: '', PANOS_VERIFY_TLS: '', PANOS_REST_VERSION: '',
  CFG_PANOS_HOST: '', CFG_PANOS_API_KEY: '', CFG_PANOS_USERNAME: '', CFG_PANOS_PASSWORD: '',
  CFG_PANOS_TARGET: '', CFG_PANOS_VERIFY_TLS: '', CFG_PANOS_REST_VERSION: '',
};

// Shaped like a real PAN-OS key (long, base64-ish) so the no-leak assertion
// below has 6+ character prefixes to hunt for. Never a real credential.
const FAKE_KEY = 'LUFRPT1QUk9CRWZha2VrZXlub3RyZWFsMDEyMzQ1Njc4OQ==';

const cases = [
  ['no credentials', { ...CLEAN }],
  ['host + username/password, no key (bootstrap)', { ...CLEAN, PANOS_HOST: 'fw.example.test', PANOS_USERNAME: 'admin', PANOS_PASSWORD: 'x' }],
  ['host + api key (full)', { ...CLEAN, PANOS_HOST: 'fw.example.test', PANOS_API_KEY: FAKE_KEY }],
  ['unresolved MCP placeholders', { ...CLEAN, PANOS_HOST: '${user_config.panos_host}', PANOS_API_KEY: '${user_config.panos_api_key}' }],
  // The path the plugin actually takes: the MCP host injects CFG_ names only.
  ['CFG_ only, as .mcp.json injects them', { ...CLEAN, PANOS_HOST: undefined, PANOS_API_KEY: undefined, CFG_PANOS_HOST: 'fw.example.test', CFG_PANOS_API_KEY: FAKE_KEY }],
  ['CFG_ unresolved placeholders', { ...CLEAN, PANOS_HOST: undefined, PANOS_API_KEY: undefined, CFG_PANOS_HOST: '${user_config.panos_host}', CFG_PANOS_API_KEY: '${user_config.panos_api_key}' }],
];

// Progressive disclosure, per docs/panos-connector-design.md: the tool list a
// client sees is a function of the credential state, so the count is asserted
// exactly in each one rather than "at least 50" - a state that quietly gains
// or drops a tool is a disclosure bug.
const EXPECTED_TOOLS = {
  'no credentials': 2,
  'host + username/password, no key (bootstrap)': 3,
  'host + api key (full)': 60,
  'unresolved MCP placeholders': 2,
  'CFG_ only, as .mcp.json injects them': 60,
  'CFG_ unresolved placeholders': 2,
};
const EXPECTED_DESTRUCTIVE_PREFIXED = 32;

let failures = 0;
for (const [label, env] of cases) {
  const { tools, statusText } = await probe(label, env);
  const names = tools.map((t) => t.name).sort();
  const destructivePrefixed = tools.filter((t) => t.description.startsWith('DESTRUCTIVE:')).length;
  console.log(`\n[${label}] ${tools.length} tools, ${destructivePrefixed} DESTRUCTIVE:-prefixed`);
  console.log('  ' + names.join(', '));
  if (tools.length !== EXPECTED_TOOLS[label]) {
    console.log(`  TOOL COUNT CHANGED: expected ${EXPECTED_TOOLS[label]} in this credential state`);
    failures++;
  }
  if (tools.length === EXPECTED_TOOLS['host + api key (full)'] && destructivePrefixed !== EXPECTED_DESTRUCTIVE_PREFIXED) {
    console.log(`  DESTRUCTIVE PREFIX COUNT CHANGED: expected ${EXPECTED_DESTRUCTIVE_PREFIXED}`);
    failures++;
  }
  // Same facts, named by failure mode: the generic count message above does not
  // tell a future reader that CFG_ translation is the thing that broke.
  if (label.startsWith('CFG_ only') && tools.length < 50) {
    console.log('  CFG_ TRANSLATION BROKEN: the plugin path never reaches the full tool set');
    failures++;
  }
  if (label === 'CFG_ unresolved placeholders' && tools.length !== 2) {
    console.log('  UNRESOLVED CFG_ PLACEHOLDERS LEAKED THROUGH as a real host');
    failures++;
  }

  // panos_status runs in every credential state and must confirm the key
  // WITHOUT emitting any part of it: it rendered `LUFRPT...` into the live
  // transcript before this was fixed, which is a long-lived credential
  // fragment under FTC Safeguards / Reg S-P.
  if (!statusText.includes('PAN-OS MCP Server Status')) {
    console.log('  panos_status DID NOT RUN in this credential state');
    failures++;
  }
  const keyLine = statusText.split('\n').find((l) => l.startsWith('PANOS_API_KEY:')) ?? '(absent)';
  console.log(`  panos_status key line: ${keyLine}`);
  const configuredKey = env.PANOS_API_KEY || env.CFG_PANOS_API_KEY || '';
  if (configuredKey && !configuredKey.startsWith('${')) {
    const leakedPrefixLengths = [];
    for (let n = 6; n <= configuredKey.length; n++) {
      if (statusText.includes(configuredKey.slice(0, n))) leakedPrefixLengths.push(n);
    }
    if (leakedPrefixLengths.length) {
      console.log(`  API KEY FRAGMENT LEAKED by panos_status (prefix lengths ${leakedPrefixLengths.join(', ')})`);
      failures++;
    }
    if (keyLine !== `PANOS_API_KEY: configured (${configuredKey.length} chars)`) {
      console.log('  panos_status must report the key as configured plus its length');
      failures++;
    }
  } else if (keyLine !== 'PANOS_API_KEY: not set') {
    console.log('  panos_status must report an absent/unresolved key as "not set"');
    failures++;
  }

  // Descriptions that carry a live-validated fact a model gets wrong without
  // them: show devices is Panorama-only, and PAN-OS keeps log/report jobs
  // outside the job table panos_job_status reads (both confirmed against a
  // standalone PA-460 on PAN-OS 11.1.13-h6).
  if (tools.length >= 50) {
    const mustMention = [
      ['panos_devices_list', ['Panorama']],
      ['panos_logs_query', ['panos_logs_retrieve']],
      ['panos_report_dynamic', ['panos_report_get']],
      ['panos_report_predefined', ['panos_report_get']],
      ['panos_report_custom', ['panos_report_get']],
      ['panos_job_status', ['panos_logs_retrieve', 'panos_report_get']],
      ['panos_job_wait', ['panos_logs_retrieve', 'panos_report_get']],
    ];
    for (const [n, needles] of mustMention) {
      const t = tools.find((x) => x.name === n);
      if (!t) { console.log(`  MISSING TOOL: ${n}`); failures++; continue; }
      for (const needle of needles) {
        if (!t.description.includes(needle)) {
          console.log(`  ${n} description does not mention ${needle}`);
          failures++;
        }
      }
    }
  }

  // ---- description prefix vs annotation agreement, in both directions -----
  // The `DESTRUCTIVE: ` prose prefix and the readOnlyHint / destructiveHint
  // annotations must come from ONE decision. They did not: 22 of the 32
  // prefixed tools shipped readOnlyHint:true / destructiveHint:false, so a
  // client reading annotations - which is how a client decides whether to
  // auto-run a tool or prompt a human - saw panos_commit, panos_commit_all,
  // panos_software_install, panos_globalprotect_disconnect and 18 more as safe
  // read-only calls. Only the prefix was ever checked here, which is why it
  // survived every green run. Checked in every credential state, since
  // progressive disclosure builds a different tool list in each.
  //
  // PASSTHROUGH is the one tool whose effect is unknowable at declaration time
  // (panos_op takes arbitrary <cmd> XML): it fails closed onto the mutating
  // annotations without its description claiming every op command mutates.
  // Any OTHER unprefixed tool annotated mutating is a bug - most likely a tool
  // nobody gave an effect class, which annotate() now fails closed.
  const PASSTHROUGH = new Set(['panos_op']);
  let readClass = 0;
  let mutatingClass = 0;
  let passthroughClass = 0;
  for (const t of tools) {
    const prefixed = t.description.startsWith('DESTRUCTIVE:');
    const a = t.annotations ?? {};
    const flags = `readOnlyHint=${a.readOnlyHint}, destructiveHint=${a.destructiveHint}`;
    if (a.readOnlyHint === undefined || a.destructiveHint === undefined) {
      console.log(`  UNANNOTATED TOOL: ${t.name} (${flags})`);
      failures++;
      continue;
    }
    if (prefixed) {
      mutatingClass++;
      if (a.readOnlyHint !== false || a.destructiveHint !== true) {
        console.log(`  ANNOTATION CONTRADICTS "DESTRUCTIVE:" PREFIX: ${t.name} (${flags})`);
        failures++;
      }
    } else if (PASSTHROUGH.has(t.name)) {
      passthroughClass++;
      if (a.readOnlyHint !== false) {
        console.log(`  PASSTHROUGH ANNOTATED READ-ONLY: ${t.name} (${flags})`);
        failures++;
      }
    } else {
      readClass++;
      if (a.readOnlyHint !== true || a.destructiveHint !== false) {
        console.log(`  READ TOOL ANNOTATED MUTATING (no "DESTRUCTIVE:" prefix): ${t.name} (${flags})`);
        failures++;
      }
    }
  }
  console.log(`  annotation classes: read=${readClass}, mutating=${mutatingClass}, passthrough=${passthroughClass}`);
  if (mutatingClass !== destructivePrefixed) {
    console.log(`  CLASS COUNT DRIFT: ${destructivePrefixed} prefixed but ${mutatingClass} classed mutating`);
    failures++;
  }
  if (label.startsWith('host + api key')) {
    const reboot = tools.find((t) => t.name === 'panos_system_reboot');
    console.log(`  reboot description starts: ${JSON.stringify(reboot?.description.slice(0, 60))}`);
    console.log(`  reboot annotations: ${JSON.stringify(reboot?.annotations)}`);
    // The strongest signals available, on the one tool that takes the whole
    // site offline: mutating, irreversible, VISIBLE-TO-OTHERS in prose, and
    // NOT idempotent - a retried reboot drops traffic a second time.
    if (!reboot?.description.includes('VISIBLE-TO-OTHERS:')) {
      console.log('  panos_system_reboot must be marked VISIBLE-TO-OTHERS:');
      failures++;
    }
    if (reboot?.annotations?.idempotentHint !== false) {
      console.log('  panos_system_reboot must not claim idempotentHint');
      failures++;
    }
    // An arbitrary-command passthrough that says it can reboot the box must
    // never advertise itself as safe to auto-run.
    const op = tools.find((t) => t.name === 'panos_op');
    console.log(`  panos_op annotations: ${JSON.stringify(op?.annotations)}`);
    if (op?.annotations?.readOnlyHint !== false || op?.annotations?.destructiveHint !== true) {
      console.log('  panos_op must be annotated mutating and destructive');
      failures++;
    }
    // Every mutating tool must carry the prefix; spot-check the ones that matter.
    const mustBeDestructive = [
      'panos_config_set', 'panos_config_delete', 'panos_commit', 'panos_commit_all',
      'panos_objects_create', 'panos_objects_delete', 'panos_policies_create',
      'panos_policies_move', 'panos_system_reboot', 'panos_cert_revoke',
      'panos_globalprotect_disconnect', 'panos_updates_install',
    ];
    for (const n of mustBeDestructive) {
      const t = tools.find((x) => x.name === n);
      if (!t) { console.log(`  MISSING TOOL: ${n}`); failures++; continue; }
      if (!t.description.startsWith('DESTRUCTIVE:')) { console.log(`  NOT MARKED DESTRUCTIVE: ${n}`); failures++; }
    }
    const mustBeSafe = ['panos_config_show', 'panos_config_complete', 'panos_status', 'panos_version', 'panos_updates_check'];
    for (const n of mustBeSafe) {
      const t = tools.find((x) => x.name === n);
      if (t?.description.startsWith('DESTRUCTIVE:')) { console.log(`  READ TOOL WRONGLY MARKED DESTRUCTIVE: ${n}`); failures++; }
    }
  }
}

console.log(failures === 0 ? '\nPROBE PASS' : `\nPROBE FAIL: ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
