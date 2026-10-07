"""Hook probes: latency per hook, the 252-cell fail-open grid, wiring drift, suites."""

import json
import os
import re
import subprocess
import time
import uuid

from . import core
from .core import metric, run, skipped, timing

CMD = "python3 atlas_scorecard.py run --root <plugins/atlas> --out x.json --only "
SECONDS = {"rel": 0.25, "abs": 3.0}


def slug(label):
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")


class Sandbox:
    """A hook sandbox: hermetic env + a project outside system temp roots + transcript."""

    def __init__(self, ctx, name):
        self.ctx = ctx
        self.env, self.atlas, self.home = core.iso_env(ctx, name)
        self.proj = core.safe_project_dir(ctx)
        if self.proj:
            core.make_project(self.proj)
        self.tp = core.write_transcript(ctx.sub(name) / "transcript.jsonl")

    def sid(self):
        return "s" + uuid.uuid4().hex[:10]

    def base(self, ev, **k):
        return dict(
            session_id=self.sid(),
            cwd=str(self.proj),
            transcript_path=self.tp,
            hook_event_name=ev,
            **k,
        )

    def cmd(self, script):
        if script.endswith("atlas_doctor.py"):
            return [self.ctx.py, str(self.ctx.scripts / "atlas_doctor.py"), "--hook"]
        return [self.ctx.py, str(self.ctx.hooks / script)]

    def run(self, script, payload, extra=None, timeout=60, cwd=None):
        env = {**self.env, **(extra or {})}
        before = len(core.faults(self.atlas))
        r = run(self.cmd(script), payload, env, cwd or str(self.proj), timeout)
        r["new_faults"] = len(core.faults(self.atlas)) - before
        return r


def hook_table(sb):
    """(label, event, script, payload-builder) for every wired entry point."""
    b, p = sb.base, str(sb.proj)

    def edit(ev):
        return b(ev, tool_name="Edit", tool_input={"file_path": p + "/src/app.py"})

    def bash(ev, c):
        return b(ev, tool_name="Bash", tool_input={"command": c})

    report = (
        "STATUS: DONE\nSTEPS: 1/1\nFILES_CHANGED: none\nEVIDENCE:\n1. x\n"
        "DELIVERABLE: x\nNEXT: none"
    )
    return [
        (
            "session_boot",
            "SessionStart",
            "session_boot.py",
            lambda: b("SessionStart", source="startup"),
        ),
        (
            "atlas_doctor_hook",
            "SessionStart",
            "atlas_doctor.py",
            lambda: b("SessionStart", source="startup"),
        ),
        (
            "prompt_optimizer_eng",
            "UserPromptSubmit",
            "prompt_optimizer.py",
            lambda: b(
                "UserPromptSubmit",
                prompt="Please refactor src/app.py to add retries and update the tests",
            ),
        ),
        (
            "prompt_optimizer_chat",
            "UserPromptSubmit",
            "prompt_optimizer.py",
            lambda: b("UserPromptSubmit", prompt="thanks, that looks good"),
        ),
        (
            "recall_gate",
            "PreToolUse",
            "recall_gate.py",
            lambda: bash("PreToolUse", "git status"),
        ),
        (
            "bash_advisor",
            "PreToolUse",
            "bash_advisor.py",
            lambda: bash("PreToolUse", "ls -la"),
        ),
        (
            "fallow_gate",
            "PreToolUse",
            "fallow_gate.py",
            lambda: bash("PreToolUse", "ls -la"),
        ),
        (
            "dispatch_tripwire_pre",
            "PreToolUse",
            "dispatch_tripwire.py",
            lambda: b(
                "PreToolUse",
                tool_name="Edit",
                tool_input={
                    "file_path": p + "/src/app.py",
                    "old_string": "1",
                    "new_string": "2",
                },
            ),
        ),
        (
            "dispatch_tripwire_post",
            "PostToolUse",
            "dispatch_tripwire.py",
            lambda: b(
                "PostToolUse",
                tool_name="Bash",
                tool_input={"command": "pytest -q"},
                tool_response="ok",
            ),
        ),
        (
            "todo_capture",
            "PostToolUse",
            "todo_capture.py",
            lambda: b(
                "PostToolUse",
                tool_name="TodoWrite",
                tool_input={
                    "todos": [
                        {
                            "content": "[implement] x",
                            "status": "pending",
                            "activeForm": "x",
                        }
                    ]
                },
            ),
        ),
        (
            "format_after_edit",
            "PostToolUse",
            "format_after_edit.py",
            lambda: edit("PostToolUse"),
        ),
        (
            "docs_drift_watch",
            "PostToolUse",
            "docs_drift_watch.py",
            lambda: edit("PostToolUse"),
        ),
        (
            "connector_credential_watch",
            "PostToolUse",
            "connector_credential_watch.py",
            lambda: b(
                "PostToolUse",
                tool_name="mcp__plugin_atlas_falcon__falcon_status",
                tool_input={},
                tool_response="ok",
            ),
        ),
        (
            "completion_gate",
            "Stop",
            "completion_gate.py",
            lambda: b("Stop", stop_hook_active=False, last_assistant_message="Done."),
        ),
        ("ingest_session", "Stop", "ingest_session.py", lambda: b("Stop")),
        ("chronicle_facet", "Stop", "chronicle_facet.py", lambda: b("Stop")),
        ("memory_capture", "Stop", "memory_capture.py", lambda: b("Stop")),
        ("nudge", "Stop", "nudge.py", lambda: b("Stop")),
        (
            "worker_report_gate",
            "SubagentStop",
            "worker_report_gate.py",
            lambda: b(
                "SubagentStop",
                agent_type="atlas:implementer",
                agent_id="a" + uuid.uuid4().hex[:6],
                last_assistant_message=report,
            ),
        ),
        (
            "ingest_session_sessionend",
            "SessionEnd",
            "ingest_session.py",
            lambda: b("SessionEnd"),
        ),
        (
            "ingest_session_precompact",
            "PreCompact",
            "ingest_session.py",
            lambda: b("PreCompact"),
        ),
    ]


def probe_hook_latency(ctx):
    cmd = CMD + "hook_latency"
    sb = Sandbox(ctx, "hooklat")
    if not sb.proj:
        return [
            skipped(
                "hook_worst_p95_ms",
                "no non-temp dir for the sandbox project",
                "ms",
                group="hooks",
            )
        ]
    n = ctx.n
    out = core.latency_metrics(
        "hook_floor",
        [run(["python3", "-c", "pass"], env=sb.env)["ms"] for _ in range(n)],
        "hooks",
        cmd,
    )
    p95s, nonzero, faulted = [], 0, 0
    for label, _ev, script, mk in hook_table(sb):
        ms = []
        for _ in range(n):
            r = sb.run(script, mk(), {"ATLAS_DECISION": "off"}, timeout=120)
            ms.append(r["ms"])
            nonzero += r["rc"] != 0
            faulted += r["new_faults"]
        out += core.latency_metrics(f"hook_{slug(label)}", ms, "hooks", cmd)
        p95s.append(core.pct(ms, 95))
    out += [
        metric("hook_nonzero_exits", nonzero, "runs", "lower", cmd=cmd, group="hooks"),
        metric(
            "hook_faults_on_valid_payloads",
            faulted,
            "faults",
            "lower",
            cmd=cmd,
            group="hooks",
        ),
        timing("hook_worst_p95_ms", max(p95s), cmd, "hooks"),
    ]
    return out


# -- fail-open grid ------------------------------------------------------------
def _cases(sb):
    d = sb.ctx.sub("failopen")
    (d / "afile").write_text("i am a file")
    (d / "corrupt.db").write_bytes(os.urandom(4096))
    ro = d / "rodir"
    ro.mkdir(exist_ok=True)
    ro.chmod(0o555)
    sb.ctx.cleanups.append(lambda: ro.chmod(0o755))
    p = str(sb.proj)
    big = "A" * (20 * 1024 * 1024)
    return [
        ("empty", lambda v: "", {}),
        ("malformed_json", lambda v: "{not json", {}),
        ("json_null", lambda v: "null", {}),
        ("json_list", lambda v: "[1,2]", {}),
        ("json_str", lambda v: '"x"', {}),
        ("binary", lambda v: os.urandom(2048), {}),
        (
            "wrongtype_fields",
            lambda v: dict(
                v,
                tool_input="x",
                session_id=123,
                cwd=5,
                transcript_path=7,
                tool_name=9,
                prompt=12,
                last_assistant_message=[1],
                agent_type=3,
            ),
            {},
        ),
        ("tool_input_list", lambda v: dict(v, tool_input=[1, 2]), {}),
        (
            "huge_20MB_valid",
            lambda v: dict(
                v,
                tool_input={"command": "echo " + big, "file_path": p + "/src/app.py"},
                prompt="x " * (10 * 1024 * 1024),
                last_assistant_message="y" * (20 * 1024 * 1024),
            ),
            {},
        ),
        ("huge_20MB_garbage", lambda v: b"{" + b"z" * (20 * 1024 * 1024), {}),
        ("db_dir_is_file", lambda v: v, {"ATLAS_DB": str(d / "afile" / "atlas.db")}),
        ("db_corrupt", lambda v: v, {"ATLAS_DB": str(d / "corrupt.db")}),
        ("db_dir_readonly", lambda v: v, {"ATLAS_DB": str(ro / "atlas.db")}),
        ("cwd_nonexistent", lambda v: dict(v, cwd="/nonexistent/dir"), {}),
    ]


def probe_failopen(ctx):
    cmd = CMD + "failopen_grid"
    sb = Sandbox(ctx, "failopen")
    if not sb.proj:
        return [
            skipped(
                "failopen_crashes", "no non-temp sandbox dir", "cells", group="hooks"
            )
        ]
    cases = _cases(sb)
    # the audit's 252-cell grid = 18 entry points x 14 cases; these 3 entries are excluded
    skip = ("ingest_session_", "prompt_optimizer_chat")
    counts = {"crash": 0, "timeout": 0, "traceback_rc0": 0, "silent": 0, "traced": 0}
    bad = []
    for label, _ev, script, mk in hook_table(sb):
        if label.startswith(skip):
            continue
        for cname, cf, cenv in cases:
            if ctx.quick and cname.startswith("huge"):
                continue
            r = sb.run(
                script,
                cf(mk()),
                dict(cenv, ATLAS_DECISION="off"),
                timeout=30 if ctx.quick else 90,
            )
            if r["rc"] == "TIMEOUT":
                cls = "timeout"
            elif r["rc"] != 0:
                cls = "crash"
            elif "Traceback" in r["err"]:
                cls = "traceback_rc0"
            elif r["new_faults"]:
                cls = "traced"
            else:
                cls = "silent"
            counts[cls] += 1
            if cls in ("crash", "timeout", "traceback_rc0"):
                bad.append(f"{label}/{cname}:{cls}")
    total = sum(counts.values())
    untraced = counts["crash"] + counts["timeout"] + counts["traceback_rc0"]
    return [
        metric(
            "failopen_cells",
            total,
            "cells",
            "info",
            cmd=cmd,
            group="hooks",
            note="252 on a full run",
        ),
        metric(
            "failopen_crashes",
            counts["crash"],
            "cells",
            "lower",
            cmd=cmd,
            group="hooks",
            detail=bad,
        ),
        metric(
            "failopen_timeouts",
            counts["timeout"],
            "cells",
            "lower",
            cmd=cmd,
            group="hooks",
        ),
        metric(
            "failopen_untraced",
            untraced,
            "cells",
            "lower",
            cmd=cmd,
            group="hooks",
            note="crash, timeout or traceback-with-rc0: errors that escaped fail-open untraced",
        ),
        metric(
            "failopen_traceback_rc0",
            counts["traceback_rc0"],
            "cells",
            "lower",
            cmd=cmd,
            group="hooks",
        ),
        metric(
            "failopen_traced",
            counts["traced"],
            "cells",
            "higher",
            cmd=cmd,
            group="hooks",
            note="cells whose internal error left a hook-faults.jsonl line",
        ),
        metric(
            "failopen_silent", counts["silent"], "cells", "info", cmd=cmd, group="hooks"
        ),
    ]


# -- wiring drift ---------------------------------------------------------------
def probe_hook_drift(ctx):
    cmd = CMD + "hook_drift"
    root = ctx.root
    hj = json.loads((root / "hooks/hooks.json").read_text())
    wired = []
    for groups in hj["hooks"].values():
        for g in groups:
            for h in g["hooks"]:
                m = re.search(r"\$\{CLAUDE_PLUGIN_ROOT\}/([^\"\s]+)", h["command"])
                wired.append((m.group(1) if m else h["command"], h.get("timeout")))
    missing = [w[0] for w in wired if not (root / w[0]).exists()]
    files = {os.path.basename(w[0]) for w in wired}
    hb = json.loads((root / "contracts/hook-bridge.json").read_text())
    known = (
        set(hb.get("bridged", []))
        | set(hb.get("bridgedSessionEnd", []))
        | set(hb.get("notBridged", []))
    )
    unclassified = sorted(
        f
        for f in files
        if f.endswith(".py") and f not in known and f != "atlas_doctor.py"
    )
    unwired = sorted(known - files)
    nofile = [
        n
        for n in known
        if not (root / "hooks" / n).exists() and not (root / "scripts" / n).exists()
    ]
    norec = [
        f
        for f in sorted(files)
        if f.endswith(".py")
        and (root / "hooks" / f).exists()
        and "atlas_faults" not in (root / "hooks" / f).read_text()
    ]
    return [
        metric(
            "hooks_wired_entries", len(wired), "entries", "info", cmd=cmd, group="hooks"
        ),
        metric(
            "hooks_wired_missing_file",
            len(missing),
            "files",
            "lower",
            cmd=cmd,
            group="hooks",
            detail=missing,
        ),
        metric(
            "hooks_unclassified_in_bridge",
            len(unclassified),
            "files",
            "lower",
            cmd=cmd,
            group="hooks",
            detail=unclassified,
        ),
        metric(
            "hooks_bridge_names_unwired",
            len(unwired),
            "files",
            "lower",
            cmd=cmd,
            group="hooks",
            detail=unwired,
        ),
        metric(
            "hooks_bridge_names_without_file",
            len(nofile),
            "files",
            "lower",
            cmd=cmd,
            group="hooks",
        ),
        metric(
            "hooks_entries_without_timeout",
            sum(1 for w in wired if w[1] is None),
            "entries",
            "lower",
            cmd=cmd,
            group="hooks",
        ),
        metric(
            "hooks_without_fault_recorder",
            len(norec),
            "files",
            "lower",
            cmd=cmd,
            group="hooks",
            detail=norec,
        ),
    ]


def probe_bash_advisor_scaling(ctx):
    cmd = CMD + "bash_advisor_scaling"
    sb = Sandbox(ctx, "scaling")
    if not sb.proj:
        return [skipped("bash_advisor_100k_ms", "no sandbox dir", "ms", group="hooks")]
    out = []
    for n in (100_000,) if ctx.quick else (100_000, 300_000):
        r = sb.run(
            "bash_advisor.py",
            sb.base(
                "PreToolUse",
                tool_name="Bash",
                tool_input={"command": "echo " + "A" * n},
            ),
            timeout=100,
        )
        out.append(timing(f"bash_advisor_{n // 1000}k_ms", r["ms"], cmd, "hooks"))
    return out


def probe_completion_breaker(ctx):
    """Nine Stops 2.2s apart on a run with unmet conditions: does the gate keep blocking?"""
    cmd = CMD + "completion_breaker"
    sb = Sandbox(ctx, "breaker")
    names = ["completion_gate_blocks_of_9", "completion_gate_breaker_faults"]
    if not sb.proj:
        return [skipped(n, "no sandbox dir", "", group="gates") for n in names]
    s, p = sb.sid(), str(sb.proj)
    code = (
        f"import sys; sys.path.insert(0,{str(ctx.scripts)!r})\nimport atlas_db\n"
        f"c=atlas_db.connect(); atlas_db.init(c)\npid=atlas_db.register_project(c,{p!r})\n"
        f"rid=atlas_db.start_run(c,pid,{s!r},'t'); atlas_db.mark_orchestrating(c,{s!r},{p!r})\n"
        f"atlas_db.log_event(c,rid,'Edit','main',1,{p + '/src/app.py'!r}); c.commit()\n"
    )
    r = run([ctx.py, "-c", code], env=sb.env, cwd=p)
    if r["rc"] != 0:
        return [
            skipped(
                n, "seed failed: " + r["err"][-200:], "", group="gates", state="error"
            )
            for n in names
        ]
    blocks, before = 0, len(core.faults(sb.atlas))
    for _ in range(9):
        r = sb.run(
            "completion_gate.py",
            dict(
                session_id=s,
                cwd=p,
                hook_event_name="Stop",
                transcript_path=sb.tp,
                last_assistant_message="ATLAS | s verify | x",
            ),
        )
        blocks += core.hook_decision(r["out"]) == "block"
        time.sleep(2.2)
    return [
        metric(
            names[0],
            blocks,
            "stops",
            "higher",
            cmd=cmd,
            group="gates",
            note="drops after 5 when the circuit breaker silently disables the gate",
        ),
        metric(
            names[1],
            len(core.faults(sb.atlas)) - before,
            "faults",
            "higher",
            cmd=cmd,
            group="gates",
            note="a durable trace when the breaker trips",
        ),
    ]


# -- suites ----------------------------------------------------------------------
def parse_summary(text):
    """pytest or unittest summary -> (passed, failed, skipped, seconds) or None."""
    m = re.search(r"=+ (.*?) in ([\d.]+)s", text) or re.search(
        r"^(\d+ (?:passed|failed|errors?|skipped).*?) in ([\d.]+)s", text, re.M
    )
    if m:
        res = {"passed": 0, "failed": 0, "skipped": 0}
        for n, kind in re.findall(r"(\d+) (passed|failed|errors?|skipped)", m.group(1)):
            res[
                "skipped"
                if kind == "skipped"
                else "passed"
                if kind == "passed"
                else "failed"
            ] += int(n)
        return res["passed"], res["failed"], res["skipped"], float(m.group(2))
    m = re.search(r"Ran (\d+) tests? in ([\d.]+)s", text)
    if m:
        total, tail = int(m.group(1)), text[m.end() :]
        grab = lambda k: int((re.search(k + r"=(\d+)", tail) or [0, 0])[1])  # noqa: E731
        failed, skip = grab("failures") + grab("errors"), grab("skipped")
        return total - failed - skip, failed, skip, float(m.group(2))
    return None


FAILED_CAP = 20


def failing_ids(text):
    """Failing test ids from pytest (`FAILED id`), unittest (`FAIL:`/`ERROR:`) or bun (`(fail) id`) output, capped."""
    ids = []
    for m in re.finditer(
        r"^(?:FAILED |ERROR |(?:FAIL|ERROR): |\(fail\) )(\S.*?)(?: - .*)?$", text, re.M
    ):
        if m.group(1) not in ids:
            ids.append(m.group(1))
    return ids[:FAILED_CAP]


def suite_metrics(name, r, cmd, group="suites"):
    s = parse_summary(r["out"] + "\n" + r["err"])
    if r["rc"] == "TIMEOUT" or s is None:
        return [
            skipped(
                f"{name}_pass",
                f"unparseable/timeout (rc={r['rc']}): " + (r["out"] + r["err"])[-200:],
                "tests",
                "higher",
                cmd,
                group,
                "error",
            )
        ]
    p, f, sk, secs = s
    return [
        metric(f"{name}_pass", p, "tests", "higher", cmd=cmd, group=group),
        metric(
            f"{name}_fail",
            f,
            "tests",
            "lower",
            cmd=cmd,
            group=group,
            detail=failing_ids(r["out"] + "\n" + r["err"]),
        ),
        metric(f"{name}_skipped", sk, "tests", "info", cmd=cmd, group=group),
        # informational: the suite grows with every added test, so wall time is not a quality direction
        metric(f"{name}_wall_s", secs, "s", "info", cmd=cmd, group=group),
    ]


def _py_suite(ctx, name, directory):
    cmd = f"cd {directory} && python3 -m pytest -q -p no:cacheprovider ."
    env, _a, _h = core.suite_env(ctx, f"suite_{name}")
    if run([ctx.py, "-c", "import pytest"], env=env)["rc"] == 0:
        argv = [ctx.py, "-m", "pytest", "-q", "-p", "no:cacheprovider", "."]
    else:
        argv = [ctx.py, "-W", "ignore", "-m", "unittest", "discover", "-p", "test_*.py"]
    return suite_metrics(
        f"{name}_suite", run(argv, env=env, cwd=str(directory), timeout=1800), cmd
    )


def probe_hook_suite(ctx):
    return _py_suite(ctx, "hooks", ctx.hooks)


def probe_scripts_suite(ctx):
    return _py_suite(ctx, "scripts", ctx.scripts)


PROBES = [
    ("hook_latency", probe_hook_latency, ["hook_worst_p95_ms"], False),
    (
        "failopen_grid",
        probe_failopen,
        ["failopen_crashes", "failopen_timeouts", "failopen_untraced"],
        True,
    ),
    ("hook_drift", probe_hook_drift, [], False),
    ("bash_advisor_scaling", probe_bash_advisor_scaling, [], False),
    (
        "completion_breaker",
        probe_completion_breaker,
        ["completion_gate_blocks_of_9"],
        True,
    ),
    ("hook_suite", probe_hook_suite, ["hooks_suite_pass", "hooks_suite_fail"], True),
    (
        "scripts_suite",
        probe_scripts_suite,
        ["scripts_suite_pass", "scripts_suite_fail"],
        True,
    ),
]
