"""Connector probes: boot with NO credentials, time-to-ready, status honesty, and the
dashboard's 'configured' truthfulness. Child env is built from scratch: no vendor
secrets, no network calls, ATLAS_ENV_FILE pointed at a missing file."""

import json
import os
import re
import shutil

from . import core
from .core import metric, run, skipped
from .probe_hooks import CMD

PROBE_MJS = r"""
import { spawn } from 'node:child_process';
const ROOT = process.env.SC_PLUGIN, HOME = process.env.SC_HOME, N = +process.env.SC_N;
async function probe(svc) {
  const env = { PATH: process.env.PATH, HOME, TMPDIR: HOME, MCP_TRANSPORT: 'stdio', ATLAS_ENV_FILE: '/nonexistent' };
  const isPy = svc === 'falcon';
  let cmd = 'node', args = ['--import', ROOT + '/mcp/_env/load.mjs', ROOT + `/mcp/${svc}/server.mjs`];
  if (isPy) { cmd = 'uv'; args = ['run', '--project', ROOT + '/mcp/falcon', 'python', ROOT + '/mcp/_env/load.py', 'falcon_mcp.server'];
    Object.assign(env, { UV_NO_SYNC: '1', UV_FROZEN: '1', UV_PROJECT_ENVIRONMENT: '.venv.nosync.noindex' }); }
  const t0 = performance.now();
  const c = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'], cwd: HOME });
  let buf = '', err = ''; const waiters = new Map();
  c.on('error', () => {});
  c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(l); if (m.id && waiters.has(m.id)) waiters.get(m.id)(m); } catch {} } });
  c.stderr.on('data', (d) => (err += d));
  const rpc = (id, method, params) => new Promise((res) => { const to = setTimeout(() => res({ timeout: true }), 15000);
    waiters.set(id, (m) => { clearTimeout(to); res(m); }); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sc', version: '1' } });
  const ready = performance.now() - t0;
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tl = await rpc(2, 'tools/list', {});
  const tools = (tl.result?.tools || []).map((t) => t.name);
  const st = tools.find((n) => n.endsWith('_status'));
  let status = null;
  if (st) { const r = await rpc(3, 'tools/call', { name: st, arguments: {} });
    status = r.timeout ? 'TIMEOUT' : (r.result?.content?.[0]?.text ?? JSON.stringify(r.result ?? r.error)); }
  const total = performance.now() - t0;
  c.kill();
  return { ready, total, n: tools.length, status, isError: false };
}
const out = {};
for (const svc of process.argv.slice(2)) {
  const ready = [], total = []; let last = null, okst = 0;
  for (let i = 0; i < N; i++) { const x = await probe(svc); ready.push(x.ready); total.push(x.total); last = x;
    if (x.status && x.status !== 'TIMEOUT') okst++; }
  out[svc] = { ready, total, tools: last.n, status_ok: okst, runs: N, status: (last.status || '').slice(0, 800) };
}
console.log('SC_RESULT ' + JSON.stringify(out));
"""

CONFIG_PY = r"""
import json, os, sys, tempfile
os.environ["ATLAS_HOME"] = tempfile.mkdtemp()
sys.path.insert(0, os.environ["SC_SCRIPTS"])
import atlas_dashboard as d
import atlas_control
man = d._plugin_manifest(); uc = man["userConfig"]
sens = [k for k, v in uc.items() if v.get("sensitive")]
d._env_file_present_keys = lambda: set(); d._env_file_values = lambda: {}; d._load_cred_marks = lambda: {}
d._connector_usage_map = lambda: {}
atlas_control._disabled_servers = lambda: []
def run(opts):
    d._plugin_config_options = lambda: opts
    return {c["name"]: c["configured_hint"] for c in d._connector_status()}
only_secret = run({k: "x" for k in sens})
unusable = ["auvik", "cipp", "connectwise", "spanning", "falcon", "ninjaone", "paylocity", "vanta", "panos"]
fp = [n for n in unusable if only_secret.get(n)]
valid = [("blumira", {"blumira_jwt_token": "x"}), ("panos", {"panos_host": "h", "panos_api_key": "x"}),
         ("cipp", {"cipp_base_url": "u", "cipp_api_key": "x"}),
         ("ninjaone", {"ninjaone_client_id": "x", "ninjaone_auth_mode": "user"})]
fn = [n for n, o in valid if not run(o).get(n)]
print("SC_RESULT " + json.dumps({"false_positive": fp, "false_negative": fn, "connectors": len(only_secret)}))
"""

ACTIONABLE = re.compile(
    r"\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b|not configured|missing|required|set (the )?env|credential",
    re.I,
)


def _services(ctx):
    return sorted(
        p.name
        for p in (ctx.root / "mcp").iterdir()
        if p.is_dir()
        and not p.name.startswith("_")
        and ((p / "server.mjs").exists() or p.name == "falcon")
    )


def probe_nocreds_boot(ctx):
    cmd = CMD + "connector_boot"
    names = [
        "connector_boot_count",
        "connector_status_reachable",
        "connector_nocreds_actionable_rate",
    ]
    node = shutil.which("node")
    if not node:
        return [skipped(n, "node not installed", group="connectors") for n in names]
    svcs = _services(ctx)
    skip_falcon = "falcon" in svcs and not shutil.which("uv")
    if skip_falcon:
        svcs.remove("falcon")
    env, _a, home = core.iso_env(ctx, "connectors", tmux=False)
    script = ctx.sub("connectors") / "probe.mjs"
    script.write_text(PROBE_MJS)
    n = 3 if ctx.quick else 8
    env.update(
        SC_PLUGIN=str(ctx.root),
        SC_HOME=str(home),
        SC_N=str(n),
    )
    env["PATH"] = os.environ["PATH"]
    r = run([node, str(script), *svcs], env=env, cwd=str(home), timeout=900)
    line = next(
        (ln for ln in r["out"].splitlines() if ln.startswith("SC_RESULT ")), None
    )
    if not line:
        return [
            skipped(
                x,
                "connector probe failed: " + (r["err"] + r["out"])[-250:],
                group="connectors",
                state="error",
            )
            for x in names
        ]
    res = json.loads(line[10:])
    out = [
        metric(
            "connector_count",
            len(res),
            "connectors",
            "info",
            cmd=cmd,
            group="connectors",
        ),
        metric(
            "connector_boot_count",
            sum(1 for v in res.values() if v["tools"] > 0),
            "connectors",
            "higher",
            cmd=cmd,
            group="connectors",
            note="boot + tools/list with no credentials",
        ),
        metric(
            "connector_nocreds_tools",
            sum(v["tools"] for v in res.values()),
            "tools",
            "info",
            cmd=cmd,
            group="connectors",
            note="tools exposed with no credentials",
        ),
        metric(
            "connector_status_reachable",
            sum(1 for v in res.values() if v["status_ok"] == v["runs"]),
            "connectors",
            "higher",
            cmd=cmd,
            group="connectors",
            note="*_status answered on every run",
        ),
    ]
    actionable, ok_true = 0, 0
    for svc, v in sorted(res.items()):
        st = v.get("status") or ""
        actionable += bool(ACTIONABLE.search(st)) and st != "TIMEOUT"
        try:
            j = json.loads(st)
            ok_true += isinstance(j, dict) and j.get("ok") is True
        except Exception:
            pass
        out.append(
            core.timing(
                f"connector_{svc}_ready_p50_ms",
                core.pct(v["ready"], 50),
                cmd,
                "connectors",
                detail={"n": v["runs"], "p95": round(core.pct(v["ready"], 95), 1)},
            )
        )
    ready_all = [x for v in res.values() for x in v["ready"]]
    out += core.latency_metrics("connector_ready_all", ready_all, "connectors", cmd)
    out += [
        metric(
            "connector_nocreds_actionable_rate",
            round(actionable / max(1, len(res)), 3),
            "ratio",
            "higher",
            {"abs": 0.0},
            cmd,
            "connectors",
            note="no-credential *_status text names what to set",
        ),
        metric(
            "connector_nocreds_status_ok_true",
            ok_true,
            "connectors",
            "lower",
            cmd=cmd,
            group="connectors",
            note="status JSON says ok:true while no credentials are set",
        ),
    ]
    if skip_falcon:
        out.append(
            skipped(
                "connector_falcon_ready_p50_ms",
                "uv not installed",
                "ms",
                cmd=cmd,
                group="connectors",
            )
        )
    return out


def probe_boot_harness(ctx):
    """The repo's own boot + annotation gate (placeholder creds): test-mcp-tools.mjs."""
    cmd = "node test-mcp-tools.mjs"
    names = ["boot_harness_rc", "boot_harness_tools"]
    harness = ctx.repo / "test-mcp-tools.mjs"
    node = shutil.which("node")
    if not harness.exists() or not node:
        return [
            skipped(n, "test-mcp-tools.mjs or node missing", group="connectors")
            for n in names
        ]
    env, _a, home = core.iso_env(ctx, "bootharness", tmux=False)
    env["PATH"] = os.environ["PATH"]
    env["HOME"] = os.path.expanduser(
        "~"
    )  # uv (falcon) needs its cache; harness uses placeholder creds only
    r = run([node, str(harness)], env=env, cwd=str(ctx.repo), timeout=600)
    text = r["out"] + r["err"]
    total = re.search(r"(\d+)\s+tools", text.splitlines()[-1]) if text.strip() else None
    tools = (
        sum(int(x) for x in re.findall(r"(\d+) tools", text))
        if total is None
        else int(total.group(1))
    )
    fails = len(re.findall(r"\bFAIL\b", text))
    return [
        metric(
            "boot_harness_rc",
            0 if r["rc"] == 0 else 1,
            "rc",
            "lower",
            cmd=cmd,
            group="connectors",
        ),
        metric(
            "boot_harness_fail_lines",
            fails,
            "lines",
            "lower",
            cmd=cmd,
            group="connectors",
        ),
        metric(
            "boot_harness_tools", tools, "tools", "info", cmd=cmd, group="connectors"
        ),
    ]


def probe_configured_truth(ctx):
    cmd = CMD + "connector_configured_truth"
    names = [
        "connector_configured_false_positive",
        "connector_configured_false_negative",
    ]
    env, _a, _h = core.iso_env(ctx, "cfgtruth", tmux=False)
    d = ctx.sub("cfgtruth")
    f = d / "cfg.py"
    f.write_text(CONFIG_PY)
    r = run(
        [ctx.py, str(f)],
        env={**env, "SC_SCRIPTS": str(ctx.scripts)},
        cwd=str(d),
        timeout=120,
    )
    line = next(
        (ln for ln in r["out"].splitlines() if ln.startswith("SC_RESULT ")), None
    )
    if not line:
        return [
            skipped(
                n,
                "dashboard connector status unavailable: "
                + (r["err"] + r["out"])[-250:],
                group="connectors",
                state="error",
            )
            for n in names
        ]
    j = json.loads(line[10:])
    return [
        metric(
            names[0],
            len(j["false_positive"]),
            "of 9",
            "lower",
            cmd=cmd,
            group="connectors",
            detail=j["false_positive"],
            note="connectors that need more than a secret, shown configured with only the secret set",
        ),
        metric(
            names[1],
            len(j["false_negative"]),
            "of 4",
            "lower",
            cmd=cmd,
            group="connectors",
            detail=j["false_negative"],
            note="valid alternate-auth setups shown unconfigured",
        ),
    ]


PROBES = [
    (
        "connector_boot",
        probe_nocreds_boot,
        ["connector_boot_count", "connector_status_reachable"],
        False,
    ),
    ("boot_harness", probe_boot_harness, ["boot_harness_rc"], False),
    (
        "connector_configured_truth",
        probe_configured_truth,
        ["connector_configured_false_positive", "connector_configured_false_negative"],
        False,
    ),
]
