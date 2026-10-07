"""omp extension probes: bun suite, typecheck, hook-bridge latency and hang budget."""

import glob
import json
import os
import re
import shutil

from . import core
from .core import metric, run, skipped, timing
from .probe_hooks import CMD, failing_ids, suite_metrics

BRIDGE_TS = r"""
import { registerHookBridge, runHook } from "%(bridge)s";
const handlers: Record<string, Function> = {};
const pi: any = { on: (n: string, f: Function) => { handlers[n] = f; } };
registerHookBridge(pi, { run: runHook });
const ctx: any = { cwd: "%(cwd)s", agent: { kind: "main" }, sessionManager: { getSessionId: () => "sc-sess" }, model: { provider: "anthropic", id: "x" } };
const N = %(n)d;
const out: Record<string, number[]> = {};
const cases: [string, any][] = [["read", { path: "src/app.py" }], ["bash", { command: "ls -la" }], ["edit", { path: "%(cwd)s/src/app.py", edits: [] }], ["grep", { pattern: "foo" }]];
for (const [tool, input] of cases) for (let i = 0; i < N; i++) {
  const s = performance.now();
  await handlers.tool_call({ toolName: tool, input }, ctx);
  const m = performance.now();
  await handlers.tool_result({ toolName: tool, input, content: [{ type: "text", text: "ok" }], isError: false }, ctx);
  (out[tool + ":pre"] ??= []).push(m - s); (out[tool + ":post"] ??= []).push(performance.now() - m);
}
for (let i = 0; i < N; i++) {
  const s = performance.now();
  await runHook("python3 -c pass", { hook_event_name: "PreToolUse" }, 10000);
  (out["floor:run"] ??= []).push(performance.now() - s);
}
console.log("SC_RESULT " + JSON.stringify(out));
"""

HANG_TS = r"""
import { registerHookBridge } from "%(bridge)s";
const h: any = {}; const pi: any = { on: (n: string, f: Function) => { h[n] = f; } };
registerHookBridge(pi, { run: async (_c: string, _p: any, ms: number) => { await Bun.sleep(ms); return ""; } });
const ctx: any = { cwd: "%(cwd)s", agent: { kind: "main" }, sessionManager: { getSessionId: () => "s" } };
const t0 = performance.now();
const a = h.tool_call({ toolName: "bash", input: { command: "ls" } }, ctx).then(() => performance.now() - t0);
const t1 = performance.now();
const b = h.tool_call({ toolName: "task", input: { tasks: [1, 2, 3].map((i) => ({ agent: "atlas:implementer", task: "x" + i })) } }, ctx).then(() => performance.now() - t1);
const [bash, task] = await Promise.all([a, b]);
console.log("SC_RESULT " + JSON.stringify({ bash, task3: task }));
"""


def bun_env(ctx, name):
    """Hermetic env for bun: temp HOME with a symlinked ~/.bun so global modules resolve."""
    env, atlas, home = core.iso_env(ctx, name)
    real_bun = os.path.expanduser("~/.bun")
    if os.path.isdir(real_bun) and not (home / ".bun").exists():
        (home / ".bun").symlink_to(real_bun)
    return env, home


def _bun(ctx):
    return shutil.which("bun")


def probe_bun_suite(ctx):
    cmd = (
        f"cd {ctx.root}/omp && ATLAS_HOME=$(mktemp -d) ATLAS_DASHBOARD=off ATLAS_COLONY=off "
        "ATLAS_DASHBOARD_PORT=17969 bun test"
    )
    bun = _bun(ctx)
    if not bun:
        return [
            skipped(
                "omp_suite_pass", "bun not installed", "tests", "higher", cmd, "omp"
            )
        ]
    env, _ = bun_env(ctx, "bunsuite")
    env["HOME"] = os.environ.get("HOME", env["HOME"])  # see core.suite_env
    env.pop("ATLAS_GATES", None)
    r = run([bun, "test"], env=env, cwd=str(ctx.root / "omp"), timeout=900)
    text = r["out"] + "\n" + r["err"]
    p = re.search(r"^\s*(\d+) pass", text, re.M)
    f = re.search(r"^\s*(\d+) fail", text, re.M)
    w = re.search(r"Ran \d+ tests? across \d+ files?\. \[([\d.]+)(ms|s)\]", text)
    if r["rc"] == "TIMEOUT" or not (p and f):
        return [
            skipped(
                "omp_suite_pass",
                f"unparseable bun output (rc={r['rc']}): {text[-200:]}",
                "tests",
                "higher",
                cmd,
                "omp",
                "error",
            )
        ]
    secs = (
        (float(w.group(1)) / (1000 if w.group(2) == "ms" else 1))
        if w
        else r["ms"] / 1000
    )
    return [
        metric(
            "omp_suite_pass", int(p.group(1)), "tests", "higher", cmd=cmd, group="omp"
        ),
        metric(
            "omp_suite_fail",
            int(f.group(1)),
            "tests",
            "lower",
            cmd=cmd,
            group="omp",
            detail=failing_ids(text),
        ),
        # informational: the suite grows with every added test
        metric("omp_suite_wall_s", secs, "s", "info", cmd=cmd, group="omp"),
    ]


def probe_typecheck(ctx):
    cmd = "tsc -p <generated tsconfig: omp/*.ts non-test, paths -> omp dist types + bun-types> --noEmit"
    tsc = shutil.which("tsc")
    omp_types = os.path.expanduser(
        "~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/types/index.d.ts"
    )
    bt = sorted(
        glob.glob(os.path.expanduser("~/.bun/install/cache/bun-types/*/index.d.ts"))
    )
    if not tsc or not os.path.exists(omp_types) or not bt:
        why = (
            "tsc missing"
            if not tsc
            else "omp dist types missing"
            if not os.path.exists(omp_types)
            else "bun-types cache missing"
        )
        return [skipped("omp_typecheck_errors", why, "errors", "lower", cmd, "omp")]
    bdir = os.path.dirname(bt[-1])
    files = sorted(
        str(p) for p in (ctx.root / "omp").glob("*.ts") if ".test." not in p.name
    )
    tsconfig = {
        "compilerOptions": {
            "strict": True,
            "noEmit": True,
            "skipLibCheck": True,
            "target": "esnext",
            "module": "esnext",
            "moduleResolution": "bundler",
            "typeRoots": [
                os.path.expanduser("~/.bun/install/global/node_modules/@types"),
                os.path.dirname(bdir),
            ],
            "types": ["node"],
            "paths": {
                "@oh-my-pi/pi-coding-agent": [omp_types],
                "bun:test": [bdir + "/test.d.ts"],
                "bun:sqlite": [bdir + "/sqlite.d.ts"],
                "bun": [bdir + "/index.d.ts"],
            },
        },
        "files": files,
    }
    cfg = ctx.sub("tsc") / "tsconfig.json"
    cfg.write_text(json.dumps(tsconfig))
    env, _, _ = core.iso_env(ctx, "tsc")
    env["HOME"] = os.path.expanduser(
        "~"
    )  # tsc only reads; needs no state, avoids a broken global path
    r = run([tsc, "-p", str(cfg)], env=env, timeout=300)
    errs = re.findall(r"error TS\d+", r["out"] + r["err"])
    if r["rc"] in ("TIMEOUT", "OSERROR"):
        return [
            skipped(
                "omp_typecheck_errors",
                f"tsc failed to run: {r['rc']}",
                "errors",
                "lower",
                cmd,
                "omp",
                "error",
            )
        ]
    return [
        metric(
            "omp_typecheck_errors",
            len(errs),
            "errors",
            "lower",
            cmd=cmd,
            group="omp",
            note="approximation: ad-hoc tsconfig (the tree ships none)",
        )
    ]


def _bridge_run(ctx, name, src, timeout):
    env, _ = bun_env(ctx, name)
    d = ctx.sub(name)
    proj = d / "proj"
    (proj / "src").mkdir(parents=True, exist_ok=True)
    (proj / "src/app.py").write_text("x = 1\n")
    script = d / "probe.ts"
    script.write_text(src)
    r = run([_bun(ctx), str(script)], env=env, cwd=str(proj), timeout=timeout)
    line = next(
        (ln for ln in r["out"].splitlines() if ln.startswith("SC_RESULT ")), None
    )
    return (json.loads(line[10:]) if line else None), r


def _fmt(tpl, ctx, name, **extra):
    proj = ctx.sub(name) / "proj"
    return tpl % dict(
        bridge=str(ctx.root / "omp/hook-bridge.ts"), cwd=str(proj), **extra
    )


def probe_bridge_latency(ctx):
    cmd = CMD + "bridge_latency"
    if not _bun(ctx):
        return [
            skipped(
                "bridge_bash_pre_p50_ms",
                "bun not installed",
                "ms",
                cmd=cmd,
                group="omp",
            )
        ]
    res, r = _bridge_run(ctx, "bridge", _fmt(BRIDGE_TS, ctx, "bridge", n=ctx.n), 300)
    if res is None:
        return [
            skipped(
                "bridge_bash_pre_p50_ms",
                "bridge probe produced no result: " + (r["err"] + r["out"])[-250:],
                "ms",
                cmd=cmd,
                group="omp",
                state="error",
            )
        ]
    out, per_call = [], {}
    for key, v in res.items():
        tool, phase = key.split(":")
        name = "bridge_floor" if tool == "floor" else f"bridge_{tool}_{phase}"
        out += core.latency_metrics(name, v, "omp", cmd)
        if tool != "floor":
            per_call.setdefault(tool, []).append(core.pct(v, 50))
    out.append(
        timing(
            "bridge_bash_total_p50_ms",
            sum(per_call["bash"]),
            cmd,
            "omp",
            note="pre+post p50 for one bash call",
        )
    )
    return out


def probe_bridge_hang(ctx):
    cmd = CMD + "bridge_hang"
    if not _bun(ctx):
        return [
            skipped(
                "bridge_hang_bash_ms", "bun not installed", "ms", cmd=cmd, group="omp"
            )
        ]
    res, r = _bridge_run(ctx, "bridgehang", _fmt(HANG_TS, ctx, "bridgehang"), 300)
    if res is None:
        return [
            skipped(
                "bridge_hang_bash_ms",
                "hang probe produced no result: " + (r["err"] + r["out"])[-250:],
                "ms",
                cmd=cmd,
                group="omp",
                state="error",
            )
        ]
    # omp blocks a tool_call at 30000 ms; a bridge that exceeds it turns a fail-open hook hang into a blocked call
    return [
        timing(
            "bridge_hang_bash_ms",
            res["bash"],
            cmd,
            "omp",
            note="all hooks hang; omp's own timeout is 30000",
        ),
        timing("bridge_hang_task3_ms", res["task3"], cmd, "omp"),
        metric(
            "bridge_hang_over_30s",
            int(res["bash"] > 30000) + int(res["task3"] > 30000),
            "calls",
            "lower",
            cmd=cmd,
            group="omp",
            note="tool_calls that outlive omp's 30 s timeout",
        ),
    ]


PROBES = [
    ("bun_suite", probe_bun_suite, ["omp_suite_pass", "omp_suite_fail"], True),
    ("typecheck", probe_typecheck, ["omp_typecheck_errors"], False),
    ("bridge_latency", probe_bridge_latency, ["bridge_bash_pre_p50_ms"], False),
    ("bridge_hang", probe_bridge_hang, ["bridge_hang_bash_ms"], True),
]
