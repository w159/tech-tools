#!/usr/bin/env node
// =====================================================================
// MCP server end-to-end tool tester.
//
//   node test-mcp-tools.mjs           # run every server with creds in .env
//   node test-mcp-tools.mjs threatlocker connectwise
//
// For each selected server, the harness:
//   1. Extracts the .mcpb bundle to a temp dir.
//   2. Spawns the entry over stdio with env vars from .env.
//   3. Sends initialize + tools/list to verify boot.
//   4. Sends one or more tools/call with safe read tools.
//   5. Prints PASS/FAIL and the first ~80 chars of the real response body.
//
// A server with empty required env vars in .env is reported as SKIPPED.
// =====================================================================

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = __dirname;

// ---------------- .env loader (no dep on dotenv) ----------------
function loadEnv() {
  const env = {};
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) {
    console.error('No .env file at', envPath, '— copy .env.template to .env first.');
    process.exit(2);
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (line.trim().startsWith('#')) continue;
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[m[1]] = val;
  }
  return env;
}

// ---------------- Server registry ----------------
//   required: env vars that must be non-empty in .env to even attempt the server
//   tools:    [{ name, args, label }] — called in order. The first failure aborts the row.
const SERVERS = {
  auvik: {
    bundle: 'mcp_servers/auvik-mcp/auvik-mcp.mcpb',
    required: ['AUVIK_USERNAME', 'AUVIK_API_KEY'],
    tools: [
      { name: 'auvik_status', args: {}, label: 'status check' },
      { name: 'auvik_tenants_list', args: {}, label: 'list tenants' },
    ],
  },
  blumira: {
    bundle: 'mcp_servers/blumira-mcp/blumira-mcp.mcpb',
    required: ['BLUMIRA_JWT_TOKEN'],
    tools: [
      { name: 'blumira_status', args: {}, label: 'status check' },
    ],
  },
  cipp: {
    bundle: 'mcp_servers/cipp-mcp/cipp-mcp.mcpb',
    required: ['CIPP_BASE_URL'],
    tools: [
      { name: 'cipp_list_tenants', args: {}, label: 'list tenants' },
    ],
  },
  connectwise: {
    bundle: 'mcp_servers/connectwise-manage-mcp/connectwise-manage-mcp.mcpb',
    required: [
      'CW_MANAGE_COMPANY_ID',
      'CW_MANAGE_PUBLIC_KEY',
      'CW_MANAGE_PRIVATE_KEY',
      'CW_MANAGE_CLIENT_ID',
      'CW_MANAGE_BASE_URL',
    ],
    tools: [
      { name: 'cw_test_connection', args: {}, label: 'connection test' },
      { name: 'cw_list_boards', args: { pageSize: 1 }, label: 'list one board' },
    ],
  },
  knowbe4: {
    bundle: 'mcp_servers/knowbe4-mcp/knowbe4-mcp.mcpb',
    required: ['KNOWBE4_API_KEY'],
    tools: [
      { name: 'knowbe4_status', args: {}, label: 'status check' },
      { name: 'knowbe4_account_get', args: {}, label: 'account info' },
    ],
  },
  ninjaone: {
    bundle: 'mcp_servers/ninjaone-mcp/ninjaone-mcp.mcpb',
    required: ['NINJAONE_CLIENT_ID', 'NINJAONE_CLIENT_SECRET'],
    tools: [
      { name: 'ninjaone_status', args: {}, label: 'status check' },
      { name: 'ninjaone_organizations_list', args: { pageSize: 1 }, label: 'list one org' },
    ],
  },
  threatlocker: {
    bundle: 'mcp_servers/threatlocker-mcp/threatlocker-mcp.mcpb',
    required: ['THREATLOCKER_API_KEY'],
    tools: [
      { name: 'threatlocker_status', args: {}, label: 'status check' },
      { name: 'threatlocker_computers_list', args: { pageSize: 1 }, label: 'list one computer' },
    ],
  },
  vanta: {
    bundle: 'mcp_servers/vanta-mcp/vanta-mcp.mcpb',
    required: ['VANTA_CLIENT_ID', 'VANTA_CLIENT_SECRET'],
    tools: [
      { name: 'vanta_status', args: {}, label: 'status check' },
      { name: 'vanta_frameworks_list', args: {}, label: 'list frameworks' },
    ],
  },
  paylocity: {
    bundle: 'mcp_servers/paylocity-mcp/paylocity-mcp.mcpb',
    required: ['PAYLOCITY_CLIENT_ID', 'PAYLOCITY_CLIENT_SECRET', 'PAYLOCITY_COMPANY_ID'],
    tools: [
      { name: 'paylocity_status', args: {}, label: 'status check' },
      { name: 'paylocity_legacy_employees_list', args: {}, label: 'list employees (legacy v2)' },
    ],
  },
  spanning: {
    bundle: 'mcp_servers/kaseya-spanning-backup-mcp/kaseya-spanning-backup-mcp.mcpb',
    required: ['SPANNING_ADMIN_EMAIL', 'SPANNING_API_TOKEN'],
    tools: [
      { name: 'spanning_status', args: {}, label: 'status check' },
      { name: 'spanning_license_get', args: {}, label: 'license / seat usage' },
      { name: 'spanning_users_list', args: { limit: 1 }, label: 'list one user' },
    ],
  },
};

// ---------------- MCP stdio client (no dep on SDK) ----------------
class McpClient {
  constructor(bundleDir, env) {
    this.bundleDir = bundleDir;
    this.env = env;
    this.proc = null;
    this.buffer = '';
    this.pendingById = new Map();
    this.nextId = 0;
    this.exited = false;
    this.stderrBuffer = '';
  }
  async start() {
    const manifest = JSON.parse(readFileSync(join(this.bundleDir, 'manifest.json'), 'utf8'));
    const entry = manifest.server.entry_point;
    // Build process env from manifest mcp_config.env (resolves ${user_config.x} from this.env)
    const cfgEnv = manifest.server?.mcp_config?.env || {};
    const procEnv = { ...process.env };
    for (const [k, raw] of Object.entries(cfgEnv)) {
      if (typeof raw !== 'string') continue;
      const replaced = raw
        .replace(/\$\{__dirname\}/g, this.bundleDir)
        .replace(/\$\{user_config\.([a-z0-9_]+)\}/gi, (_, key) => {
          const upper = key.toUpperCase();
          return this.env[upper] ?? this.env[k] ?? '';
        });
      procEnv[k] = replaced;
    }
    this.proc = spawn('node', [entry], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: procEnv,
      cwd: this.bundleDir,
    });
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pendingById.has(msg.id)) {
            const pending = this.pendingById.get(msg.id);
            this.pendingById.delete(msg.id);
            pending.resolve(msg);
          }
        } catch {
          /* not json — ignore */
        }
      }
    });
    this.proc.stderr.on('data', (chunk) => {
      this.stderrBuffer += chunk.toString('utf8');
    });
    this.proc.on('exit', () => {
      this.exited = true;
      for (const { reject } of this.pendingById.values()) {
        reject(new Error('server exited before responding'));
      }
      this.pendingById.clear();
    });
    // initialize handshake
    await this.send('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-mcp-tools', version: '0.1.0' },
    });
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );
  }
  send(method, params) {
    const id = this.nextId++;
    let timer;
    const promise = new Promise((resolve, reject) => {
      this.pendingById.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject:  (e) => { clearTimeout(timer); reject(e); },
      });
      timer = setTimeout(() => {
        if (this.pendingById.has(id)) {
          this.pendingById.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, 25_000);
    });
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    );
    return promise;
  }
  async listTools() {
    const r = await this.send('tools/list', {});
    return r.result?.tools || [];
  }
  async callTool(name, args) {
    return this.send('tools/call', { name, arguments: args });
  }
  stop() {
    if (this.proc && !this.exited) this.proc.kill('SIGTERM');
  }
}

// ---------------- Runner ----------------
function summarize(content) {
  if (!content) return '(no content)';
  if (Array.isArray(content)) {
    const first = content[0];
    if (first?.type === 'text') {
      return first.text.replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  return JSON.stringify(content).slice(0, 200);
}

// Credential-free boot check. Extracts the bundle, boots it with NO creds,
// lists tools, and calls the status/connection tool with empty args. This is
// the CLAUDE.md contract: every server must boot without crashing and its
// status tool must report the missing-creds state gracefully (not throw).
// Runs on the missing-creds skip path so a stale/empty/crashing bundle is
// caught even when the credentialed probes can't run. Note: for servers that
// gate their domain tools behind creds (blumira, connectwise), the no-creds
// tool count is intentionally small; the count is surfaced in the SKIP line so
// a 2-vs-52 regression stays visible to a human reviewer.
async function bootCheck(name, bundle) {
  const tmp = mkdtempSync(join(tmpdir(), `mcp-boot-${name}-`));
  try {
    execSync(`unzip -q "${bundle}" -d "${tmp}"`);
    const client = new McpClient(tmp, {});
    let tools = [];
    try {
      await client.start();
      tools = await client.listTools();
    } catch (e) {
      client.stop();
      return { booted: false, detail: e.message, stderr: client.stderrBuffer.split('\n').slice(0, 3).join(' | ') };
    }
    const statusTool = tools.find((t) => /(_status|test_connection)$/.test(t.name));
    let statusOk = null, statusDetail = '';
    if (statusTool) {
      try {
        const r = await client.callTool(statusTool.name, {});
        statusOk = !r.error;
        statusDetail = r.error ? (r.error.message || 'rpc error') : summarize(r.result?.content);
      } catch (e) {
        statusOk = false;
        statusDetail = e.message;
      }
    }
    client.stop();
    return { booted: true, toolCount: tools.length, statusTool: statusTool?.name, statusOk, statusDetail };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function testServer(name, def, env) {
  const bundle = join(ROOT, def.bundle);
  if (!existsSync(bundle)) return { name, status: 'NO_BUNDLE', detail: bundle };

  const missing = def.required.filter((k) => !env[k] || env[k].trim() === '');
  if (missing.length) {
    const boot = await bootCheck(name, bundle);
    if (!boot.booted) {
      return { name, status: 'FAIL', detail: `boot failed (creds absent): ${boot.detail}`, stderr: boot.stderr };
    }
    if (boot.statusTool && boot.statusOk === false) {
      return { name, status: 'FAIL', detail: `status tool ${boot.statusTool} did not respond gracefully: ${boot.statusDetail}` };
    }
    const bootNote = boot.statusTool ? `, ${boot.statusTool} graceful` : ', no status tool';
    return { name, status: 'SKIPPED', detail: `missing: ${missing.join(', ')}; boot OK (${boot.toolCount} tools${bootNote})` };
  }

  const tmp = mkdtempSync(join(tmpdir(), `mcp-test-${name}-`));
  try {
    execSync(`unzip -q "${bundle}" -d "${tmp}"`);
    const client = new McpClient(tmp, env);
    await client.start();
    const tools = await client.listTools();
    const have = new Set(tools.map((t) => t.name));
    const results = [];
    for (const step of def.tools) {
      if (!have.has(step.name)) {
        results.push({ tool: step.name, label: step.label, ok: false, detail: 'tool not in server tools/list' });
        break;
      }
      try {
        const r = await client.callTool(step.name, step.args || {});
        if (r.error) {
          results.push({ tool: step.name, label: step.label, ok: false, detail: r.error.message || JSON.stringify(r.error) });
          break;
        }
        const sample = summarize(r.result?.content);
        const isErr = r.result?.isError === true ||
                      sample.toLowerCase().startsWith('error') ||
                      sample.toLowerCase().includes('missing connectwise');
        results.push({ tool: step.name, label: step.label, ok: !isErr, detail: sample });
        if (isErr) break;
      } catch (e) {
        results.push({ tool: step.name, label: step.label, ok: false, detail: e.message });
        break;
      }
    }
    client.stop();
    const status = results.every((r) => r.ok) ? 'PASS' : 'FAIL';
    return { name, status, tools: tools.length, results, stderr: client.stderrBuffer.split('\n').slice(0, 3).join(' | ') };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const env = loadEnv();
  const arg = process.argv.slice(2);
  const selected = arg.length ? arg : Object.keys(SERVERS);
  const unknown = selected.filter((s) => !SERVERS[s]);
  if (unknown.length) {
    console.error('Unknown server(s):', unknown.join(', '));
    console.error('Available:', Object.keys(SERVERS).join(', '));
    process.exit(2);
  }
  console.log(`Running ${selected.length} server(s)...\n`);
  let passed = 0, failed = 0, skipped = 0;
  for (const name of selected) {
    process.stdout.write(`[${name}] ... `);
    const r = await testServer(name, SERVERS[name], env);
    if (r.status === 'PASS') {
      passed++;
      console.log(`PASS  (${r.tools} tools)`);
    } else if (r.status === 'SKIPPED' || r.status === 'NO_BUNDLE') {
      skipped++;
      console.log(`${r.status}  (${r.detail})`);
    } else {
      failed++;
      console.log(`FAIL`);
    }
    if (r.results) {
      for (const step of r.results) {
        const tag = step.ok ? '  ✓' : '  ✗';
        console.log(`${tag} ${step.tool.padEnd(35)} — ${step.label}`);
        console.log(`      ${step.detail.slice(0, 240)}`);
      }
      if (r.status === 'FAIL' && r.stderr?.trim()) {
        console.log(`  stderr: ${r.stderr.slice(0, 240)}`);
      }
    }
    console.log();
  }
  console.log(`Total: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});
