"""probe_hooks: Sandbox, hook table, latency, fail-open grid, wiring drift, scaling, completion breaker,
and the suite parsers. Hook processes (Sandbox.run / run) are the external boundary and are scripted;
the sandbox setup, classification, aggregation, drift arithmetic and summary parsing run for real."""

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
from scorecard import core  # noqa: E402
from scorecard import probe_hooks as ph  # noqa: E402

ROOT = HERE.parent


def byname(ms):
    return {m["name"]: m for m in ms}


def rr(rc=0, out="", err="", ms=1.0, new_faults=0):
    return {"rc": rc, "out": out, "err": err, "ms": ms, "new_faults": new_faults}


@pytest.fixture
def ctx(tmp_path):
    root = tmp_path / "plugins" / "atlas"
    (root / "scripts").mkdir(parents=True)
    (root / "hooks").mkdir()
    c = core.Ctx(root, quick=True, work=str(tmp_path / "w"), runs=2)
    c.tmux_real = None
    return c


@pytest.fixture
def sandbox_ok(ctx, tmp_path, monkeypatch):
    """Sandbox construction without git or system-temp lookups."""
    proj = tmp_path / "projdir" / "proj"
    proj.mkdir(parents=True)
    made = []
    monkeypatch.setattr(core, "safe_project_dir", lambda c, name="proj": proj)
    monkeypatch.setattr(core, "make_project", lambda root, with_git=True: made.append(root) or (root / "src").mkdir(exist_ok=True))
    return proj, made


# --- slug ---------------------------------------------------------------------------------


def test_slug():
    assert ph.slug("Prompt Optimizer/Eng") == "prompt_optimizer_eng"
    assert ph.slug("__a--b__") == "a_b"
    assert ph.slug("ABC123") == "abc123"
    assert ph.slug("!!!") == ""


# --- Sandbox -----------------------------------------------------------------------------


def test_sandbox_builds_project_and_transcript(ctx, sandbox_ok):
    proj, made = sandbox_ok
    sb = ph.Sandbox(ctx, "sbx")
    assert sb.proj == proj and made == [proj]
    assert Path(sb.tp).read_text().count("\n") == 2
    assert sb.env["ATLAS_HOME"] == str(sb.atlas)


def test_sandbox_without_safe_dir_has_no_project(ctx, monkeypatch):
    monkeypatch.setattr(core, "safe_project_dir", lambda c, name="proj": None)
    called = []
    monkeypatch.setattr(core, "make_project", lambda *a, **k: called.append(1))
    sb = ph.Sandbox(ctx, "sbx")
    assert sb.proj is None and not called


def test_sid_unique_prefixed(ctx, sandbox_ok):
    sb = ph.Sandbox(ctx, "sbx")
    a, b = sb.sid(), sb.sid()
    assert a != b and a.startswith("s") and len(a) == 11


def test_base_payload(ctx, sandbox_ok):
    sb = ph.Sandbox(ctx, "sbx")
    p = sb.base("Stop", extra=1)
    assert p["hook_event_name"] == "Stop" and p["extra"] == 1
    assert p["cwd"] == str(sb.proj) and p["transcript_path"] == sb.tp
    assert p["session_id"].startswith("s")


def test_cmd_maps_doctor_to_hook_flag_and_others_to_hooks_dir(ctx, sandbox_ok):
    sb = ph.Sandbox(ctx, "sbx")
    assert sb.cmd("atlas_doctor.py") == [ctx.py, str(ctx.scripts / "atlas_doctor.py"), "--hook"]
    assert sb.cmd("nudge.py") == [ctx.py, str(ctx.hooks / "nudge.py")]


def test_sandbox_run_merges_env_counts_new_faults(ctx, sandbox_ok, monkeypatch):
    sb = ph.Sandbox(ctx, "sbx")
    seen = {}
    faults_file = sb.atlas / "hook-faults.jsonl"
    faults_file.write_text('{"a":1}\n')

    def fake_run(argv, payload, env, cwd, timeout):
        seen.update(argv=argv, payload=payload, env=env, cwd=cwd, timeout=timeout)
        with open(faults_file, "a") as f:
            f.write('{"b":1}\n{"c":1}\n')
        return {"rc": 0, "out": "", "err": "", "ms": 5}

    monkeypatch.setattr(ph, "run", fake_run)
    r = sb.run("nudge.py", {"x": 1}, extra={"E": "1"}, timeout=7)
    assert r["new_faults"] == 2
    assert seen["env"]["E"] == "1" and seen["env"]["ATLAS_HOME"] == str(sb.atlas)
    assert seen["cwd"] == str(sb.proj) and seen["timeout"] == 7
    assert seen["argv"] == sb.cmd("nudge.py") and seen["payload"] == {"x": 1}
    sb.run("nudge.py", {}, cwd="/elsewhere")
    assert seen["cwd"] == "/elsewhere"


# --- hook_table ---------------------------------------------------------------------------


EXPECTED_LABELS = [
    "session_boot", "atlas_doctor_hook", "prompt_optimizer_eng", "prompt_optimizer_chat", "recall_gate",
    "bash_advisor", "fallow_gate", "dispatch_tripwire_pre", "dispatch_tripwire_post", "todo_capture",
    "format_after_edit", "docs_drift_watch", "connector_credential_watch", "completion_gate", "ingest_session",
    "chronicle_facet", "memory_capture", "nudge", "worker_report_gate", "ingest_session_sessionend",
    "ingest_session_precompact",
]


def test_hook_table_entries_and_payload_events(ctx, sandbox_ok):
    sb = ph.Sandbox(ctx, "sbx")
    table = ph.hook_table(sb)
    assert [t[0] for t in table] == EXPECTED_LABELS
    for label, ev, script, mk in table:
        pl = mk()
        assert pl["hook_event_name"] == ev, label
        assert script.endswith(".py")
    by = {t[0]: t for t in table}
    assert by["prompt_optimizer_chat"][3]()["prompt"] == "thanks, that looks good"
    assert "refactor" in by["prompt_optimizer_eng"][3]()["prompt"]
    assert by["bash_advisor"][3]()["tool_input"] == {"command": "ls -la"}
    assert by["format_after_edit"][3]()["tool_input"]["file_path"] == str(sb.proj) + "/src/app.py"
    assert by["completion_gate"][3]()["stop_hook_active"] is False
    todo = by["todo_capture"][3]()
    assert todo["tool_name"] == "TodoWrite" and todo["tool_input"]["todos"][0]["status"] == "pending"
    rep = by["worker_report_gate"][3]()
    assert rep["agent_type"] == "atlas:implementer" and rep["last_assistant_message"].startswith("STATUS: DONE")
    assert rep["agent_id"] != by["worker_report_gate"][3]()["agent_id"]  # a fresh agent id per payload
    assert by["dispatch_tripwire_post"][3]()["tool_name"] == "Bash"
    assert by["connector_credential_watch"][3]()["tool_name"].endswith("falcon_status")


def test_every_wired_script_exists_in_the_real_plugin(ctx, sandbox_ok):
    real = core.Ctx(ROOT, quick=True, work=str(ctx.work / "real"))
    real.tmux_real = None
    sb = ph.Sandbox(ctx, "sbx")
    for label, _ev, script, _mk in ph.hook_table(sb):
        where = real.scripts if script == "atlas_doctor.py" else real.hooks
        assert (where / script).is_file(), f"{label}: {script}"


# --- probe_hook_latency ---------------------------------------------------------------------


def test_latency_skipped_without_project_dir(ctx, monkeypatch):
    monkeypatch.setattr(core, "safe_project_dir", lambda c, name="proj": None)
    out = ph.probe_hook_latency(ctx)
    assert [o["name"] for o in out] == ["hook_worst_p95_ms"]
    assert out[0]["state"] == "skipped" and out[0]["reason"].startswith("no non-temp dir")


def test_latency_metrics_counts_and_worst(ctx, sandbox_ok, monkeypatch):
    calls = []

    def fake_sb_run(self, script, payload, extra=None, timeout=60, cwd=None):
        calls.append((script, extra, timeout))
        ms = 100.0 if script == "nudge.py" else 10.0
        bad = script == "recall_gate.py"
        return rr(1 if bad else 0, ms=ms, new_faults=2 if script == "memory_capture.py" else 0)

    monkeypatch.setattr(ph.Sandbox, "run", fake_sb_run)
    floors = []
    monkeypatch.setattr(ph, "run", lambda argv, **kw: floors.append((argv, kw)) or rr(0, ms=3.0))
    m = byname(ph.probe_hook_latency(ctx))
    assert len(floors) == 2 and floors[0][0] == ["python3", "-c", "pass"]
    assert m["hook_floor_p50_ms"]["value"] == 3.0
    assert len(calls) == 21 * 2
    assert all(c[1] == {"ATLAS_DECISION": "off"} and c[2] == 120 for c in calls)
    assert m["hook_nudge_p50_ms"]["value"] == 100.0
    assert m["hook_recall_gate_p50_ms"]["value"] == 10.0
    assert m["hook_nonzero_exits"]["value"] == 2  # recall_gate x 2 runs
    assert m["hook_faults_on_valid_payloads"]["value"] == 4  # memory_capture 2 faults x 2 runs
    assert m["hook_worst_p95_ms"]["value"] == 100.0
    assert m["hook_nonzero_exits"]["direction"] == "lower"
    assert m["hook_session_boot_p50_ms"]["detail"] == {"n": 2}


# --- _cases / probe_failopen ------------------------------------------------------------------


CASE_NAMES = [
    "empty", "malformed_json", "json_null", "json_list", "json_str", "binary", "wrongtype_fields",
    "tool_input_list", "huge_20MB_valid", "huge_20MB_garbage", "db_dir_is_file", "db_corrupt",
    "db_dir_readonly", "cwd_nonexistent",
]


def test_cases_names_payload_builders_and_env(ctx, sandbox_ok):
    sb = ph.Sandbox(ctx, "sbx")
    cases = {n: (f, e) for n, f, e in ph._cases(sb)}
    assert list(cases) == CASE_NAMES
    v = {"cwd": "/x", "tool_input": {}, "a": 1}
    assert cases["empty"][0](v) == ""
    assert cases["malformed_json"][0](v) == "{not json"
    assert cases["json_null"][0](v) == "null" and cases["json_list"][0](v) == "[1,2]" and cases["json_str"][0](v) == '"x"'
    b = cases["binary"][0](v)
    assert isinstance(b, bytes) and len(b) == 2048
    w = cases["wrongtype_fields"][0](v)
    assert w["session_id"] == 123 and w["cwd"] == 5 and w["a"] == 1 and w["last_assistant_message"] == [1]
    assert cases["tool_input_list"][0](v)["tool_input"] == [1, 2]
    assert cases["cwd_nonexistent"][0](v)["cwd"] == "/nonexistent/dir"
    assert cases["db_corrupt"][0](v) == v
    d = ctx.sub("failopen")
    assert cases["db_dir_is_file"][1] == {"ATLAS_DB": str(d / "afile" / "atlas.db")}
    assert (d / "afile").read_text() == "i am a file"
    assert len((d / "corrupt.db").read_bytes()) == 4096
    assert cases["db_corrupt"][1] == {"ATLAS_DB": str(d / "corrupt.db")}
    ro = d / "rodir"
    assert oct(ro.stat().st_mode & 0o777) == "0o555"
    assert cases["db_dir_readonly"][1] == {"ATLAS_DB": str(ro / "atlas.db")}
    assert len(ctx.cleanups) == 1
    ctx.cleanups[0]()
    assert oct(ro.stat().st_mode & 0o777) == "0o755"


def test_cases_huge_payloads_are_actually_huge(ctx, sandbox_ok):
    sb = ph.Sandbox(ctx, "sbx")
    cases = {n: f for n, f, _ in ph._cases(sb)}
    big = cases["huge_20MB_valid"]({"tool_input": {}})
    assert len(big["last_assistant_message"]) == 20 * 1024 * 1024
    assert len(big["prompt"]) == 20 * 1024 * 1024
    assert len(big["tool_input"]["command"]) > 20 * 1024 * 1024
    assert big["tool_input"]["file_path"].endswith("/src/app.py")
    g = cases["huge_20MB_garbage"]({})
    assert g.startswith(b"{z") and len(g) == 20 * 1024 * 1024 + 1


def failopen_run(ctx, monkeypatch, overrides, default=None):
    """Script Sandbox.run: overrides maps (label, case) -> result dict, in iteration order."""
    sb_holder = {}
    orig_init = ph.Sandbox.__init__

    def init(self, c, name):
        orig_init(self, c, name)
        sb_holder["sb"] = self

    monkeypatch.setattr(ph.Sandbox, "__init__", init)
    calls = []

    def fake_run(self, script, payload, extra=None, timeout=60, cwd=None):
        calls.append(dict(script=script, payload=payload, extra=extra, timeout=timeout))
        i = len(calls) - 1
        return overrides.get(i, default or rr())

    monkeypatch.setattr(ph.Sandbox, "run", fake_run)
    return calls, sb_holder


def grid_order(ctx, quick):
    # mirrors the probe's iteration: (label, case) for every executed cell
    sb = ph.Sandbox(ctx, "orderprobe")
    order = []
    for label, _e, _s, _m in ph.hook_table(sb):
        if label.startswith(("ingest_session_", "prompt_optimizer_chat")):
            continue
        for cname, _f, _e2 in ph._cases(sb):
            if quick and cname.startswith("huge"):
                continue
            order.append((label, cname))
    return order


def test_failopen_skipped_without_project(ctx, monkeypatch):
    monkeypatch.setattr(core, "safe_project_dir", lambda c, name="proj": None)
    out = ph.probe_failopen(ctx)
    assert out[0]["name"] == "failopen_crashes" and out[0]["state"] == "skipped"


def test_failopen_full_grid_is_252_cells_quick_is_216(ctx, sandbox_ok, monkeypatch):
    calls, _ = failopen_run(ctx, monkeypatch, {})
    ctx.quick = False
    m = byname(ph.probe_failopen(ctx))
    assert m["failopen_cells"]["value"] == 252 and len(calls) == 252
    assert m["failopen_silent"]["value"] == 252
    assert {c["timeout"] for c in calls} == {90}
    calls.clear()
    ctx.quick = True
    m = byname(ph.probe_failopen(ctx))
    assert m["failopen_cells"]["value"] == 216 and len(calls) == 216
    assert {c["timeout"] for c in calls} == {30}
    assert all(not isinstance(c["payload"], bytes) or len(c["payload"]) < 10_000 for c in calls)


def test_failopen_passes_decision_off_and_case_env(ctx, sandbox_ok, monkeypatch):
    calls, _ = failopen_run(ctx, monkeypatch, {})
    ph.probe_failopen(ctx)
    assert all(c["extra"]["ATLAS_DECISION"] == "off" for c in calls)
    assert any("ATLAS_DB" in c["extra"] for c in calls)
    assert {c["script"] for c in calls}.isdisjoint({"x"}) and "prompt_optimizer.py" in {c["script"] for c in calls}


def test_failopen_classification(ctx, sandbox_ok, monkeypatch):
    order = grid_order(ctx, quick=True)
    overrides = {
        0: rr("TIMEOUT"),
        1: rr(1),
        2: rr(0, err="Traceback (most recent call last)"),
        3: rr(0, new_faults=1),
        4: rr("OSERROR"),
        5: rr(0, err="Traceback", new_faults=3),  # traceback outranks traced
        6: rr(1, new_faults=2),                    # crash outranks traced
    }
    failopen_run(ctx, monkeypatch, overrides)
    m = byname(ph.probe_failopen(ctx))
    assert m["failopen_timeouts"]["value"] == 1
    assert m["failopen_crashes"]["value"] == 3  # rc 1, OSERROR, rc 1 with faults
    assert m["failopen_traceback_rc0"]["value"] == 2
    assert m["failopen_traced"]["value"] == 1
    assert m["failopen_untraced"]["value"] == 1 + 3 + 2
    assert m["failopen_silent"]["value"] == 216 - 7
    label0, case0 = order[0]
    det = m["failopen_crashes"]["detail"]
    assert f"{label0}/{case0}:timeout" in det
    assert f"{order[1][0]}/{order[1][1]}:crash" in det and f"{order[2][0]}/{order[2][1]}:traceback_rc0" in det
    assert len(det) == 6  # timeout + 3 crashes + 2 traceback cells; traced cells are not listed
    assert m["failopen_traced"]["note"].endswith("hook-faults.jsonl line")


def test_failopen_metric_directions(ctx, sandbox_ok, monkeypatch):
    failopen_run(ctx, monkeypatch, {})
    m = byname(ph.probe_failopen(ctx))
    assert m["failopen_traced"]["direction"] == "higher"
    assert m["failopen_cells"]["direction"] == "info" and m["failopen_silent"]["direction"] == "info"
    for k in ("failopen_crashes", "failopen_timeouts", "failopen_untraced", "failopen_traceback_rc0"):
        assert m[k]["direction"] == "lower"


# --- probe_hook_drift ----------------------------------------------------------------------


def make_drift_tree(ctx, hooks_json, bridge, files):
    r = ctx.root
    (r / "hooks").mkdir(exist_ok=True)
    (r / "contracts").mkdir(exist_ok=True)
    (r / "hooks" / "hooks.json").write_text(json.dumps(hooks_json))
    (r / "contracts" / "hook-bridge.json").write_text(json.dumps(bridge))
    for rel, text in files.items():
        p = r / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)


def entry(cmd, timeout=10):
    h = {"type": "command", "command": cmd}
    if timeout is not None:
        h["timeout"] = timeout
    return h


def test_drift_clean(ctx):
    hj = {"hooks": {"Stop": [{"hooks": [entry('python3 "${CLAUDE_PLUGIN_ROOT}/hooks/a.py"')]}],
                    "SessionStart": [{"hooks": [entry('python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --hook')]}]}}
    make_drift_tree(ctx, hj, {"bridged": ["a.py"]}, {"hooks/a.py": "import atlas_faults", "scripts/atlas_doctor.py": ""})
    m = byname(ph.probe_hook_drift(ctx))
    assert m["hooks_wired_entries"]["value"] == 2 and m["hooks_wired_entries"]["direction"] == "info"
    for k in ("hooks_wired_missing_file", "hooks_unclassified_in_bridge", "hooks_bridge_names_unwired",
              "hooks_bridge_names_without_file", "hooks_entries_without_timeout", "hooks_without_fault_recorder"):
        assert m[k]["value"] == 0, k


def test_drift_detects_each_problem(ctx):
    hj = {"hooks": {"Stop": [{"hooks": [
        entry('python3 "${CLAUDE_PLUGIN_ROOT}/hooks/present.py"', timeout=None),
        entry('python3 ${CLAUDE_PLUGIN_ROOT}/hooks/gone.py'),
        entry('python3 "${CLAUDE_PLUGIN_ROOT}/hooks/unclassified.py"'),
        entry("echo plain"),
    ]}]}}
    bridge = {"bridged": ["present.py"], "bridgedSessionEnd": ["se_missing.py"], "notBridged": ["nb_unwired.py"]}
    files = {
        "hooks/present.py": "no recorder here",
        "hooks/unclassified.py": "atlas_faults ok",
        "hooks/nb_unwired.py": "",
        "scripts/se_missing.py": "",
    }
    make_drift_tree(ctx, hj, bridge, files)
    m = byname(ph.probe_hook_drift(ctx))
    assert m["hooks_wired_entries"]["value"] == 4
    # 'gone.py' and the non-matching 'echo plain' (the whole command string is the path) don't exist
    assert m["hooks_wired_missing_file"]["detail"] == ["hooks/gone.py", "echo plain"]
    assert m["hooks_unclassified_in_bridge"]["detail"] == ["gone.py", "unclassified.py"]
    assert m["hooks_bridge_names_unwired"]["detail"] == ["nb_unwired.py", "se_missing.py"]
    assert m["hooks_bridge_names_without_file"]["value"] == 0
    assert m["hooks_entries_without_timeout"]["value"] == 1
    assert m["hooks_without_fault_recorder"]["detail"] == ["present.py"]


def test_drift_bridge_names_without_file_and_doctor_exempt(ctx):
    hj = {"hooks": {"S": [{"hooks": [entry('x "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py"')]}]}}
    make_drift_tree(ctx, hj, {"bridged": ["ghost.py"], "notBridged": []}, {"scripts/atlas_doctor.py": "x"})
    m = byname(ph.probe_hook_drift(ctx))
    assert m["hooks_bridge_names_without_file"]["value"] == 1
    assert m["hooks_unclassified_in_bridge"]["value"] == 0  # atlas_doctor.py is exempt
    assert m["hooks_without_fault_recorder"]["value"] == 0  # not in hooks/, so not checked


def test_drift_non_py_wired_files_are_not_classified(ctx):
    hj = {"hooks": {"S": [{"hooks": [entry('sh "${CLAUDE_PLUGIN_ROOT}/hooks/run.sh"')]}]}}
    make_drift_tree(ctx, hj, {}, {"hooks/run.sh": ""})
    m = byname(ph.probe_hook_drift(ctx))
    assert m["hooks_unclassified_in_bridge"]["value"] == 0
    assert m["hooks_without_fault_recorder"]["value"] == 0


def test_drift_against_real_plugin_has_no_missing_files():
    real = core.Ctx(ROOT, quick=True, work=str(Path(__import__("tempfile").mkdtemp())))
    real.tmux_real = None
    try:
        m = byname(ph.probe_hook_drift(real))
    finally:
        __import__("shutil").rmtree(real.work, ignore_errors=True)
    assert m["hooks_wired_missing_file"]["value"] == 0
    assert m["hooks_wired_entries"]["value"] > 10


# --- bash_advisor_scaling ---------------------------------------------------------------------


def test_scaling_skipped_without_project(ctx, monkeypatch):
    monkeypatch.setattr(core, "safe_project_dir", lambda c, name="proj": None)
    out = ph.probe_bash_advisor_scaling(ctx)
    assert out[0]["name"] == "bash_advisor_100k_ms" and out[0]["state"] == "skipped"


def test_scaling_sizes_and_payload(ctx, sandbox_ok, monkeypatch):
    calls = []

    def fake_run(self, script, payload, extra=None, timeout=60, cwd=None):
        calls.append((script, payload, timeout))
        return rr(ms=42.0 + len(calls))

    monkeypatch.setattr(ph.Sandbox, "run", fake_run)
    m = ph.probe_bash_advisor_scaling(ctx)
    assert [x["name"] for x in m] == ["bash_advisor_100k_ms"]
    assert m[0]["value"] == 43.0
    script, payload, timeout = calls[0]
    assert script == "bash_advisor.py" and timeout == 100
    assert payload["tool_input"]["command"] == "echo " + "A" * 100_000
    assert payload["tool_name"] == "Bash" and payload["hook_event_name"] == "PreToolUse"
    calls.clear()
    ctx.quick = False
    m = ph.probe_bash_advisor_scaling(ctx)
    assert [x["name"] for x in m] == ["bash_advisor_100k_ms", "bash_advisor_300k_ms"]
    assert len(calls[1][1]["tool_input"]["command"]) == len("echo ") + 300_000


# --- _tripped_sessions / probe_completion_breaker -------------------------------------------------


def test_tripped_sessions(tmp_path):
    (tmp_path / "a.json").write_text('{"breaker_tripped": true}')
    (tmp_path / "b.json").write_text('{"breaker_tripped": false}')
    (tmp_path / "c.json").write_text("{}")
    (tmp_path / "d.json").write_text("{corrupt")
    (tmp_path / "e.json").write_text("[1, 2]")  # list: no .get
    (tmp_path / "f.json").write_text('{"breaker_tripped": 1}')
    (tmp_path / "ignored.txt").write_text('{"breaker_tripped": true}')
    assert ph._tripped_sessions(tmp_path) == 2
    assert ph._tripped_sessions(tmp_path / "nope") == 0


def test_breaker_skipped_without_project(ctx, monkeypatch):
    monkeypatch.setattr(core, "safe_project_dir", lambda c, name="proj": None)
    out = ph.probe_completion_breaker(ctx)
    assert [o["name"] for o in out] == ["completion_gate_blocks_of_9", "completion_gate_breaker_faults"]
    assert all(o["state"] == "skipped" for o in out)


def test_breaker_seed_failure_is_error(ctx, sandbox_ok, monkeypatch):
    monkeypatch.setattr(ph, "run", lambda *a, **k: rr(1, err="x" * 300 + "SEEDERR"))
    monkeypatch.setattr(ph.time, "sleep", lambda s: None)
    out = ph.probe_completion_breaker(ctx)
    assert all(o["state"] == "error" for o in out)
    assert out[0]["reason"].startswith("seed failed: ") and out[0]["reason"].endswith("SEEDERR")
    assert len(out[0]["reason"]) == len("seed failed: ") + 200


def test_breaker_counts_blocks_and_tripped_sessions(ctx, sandbox_ok, monkeypatch):
    seeded = {}
    monkeypatch.setattr(ph, "run", lambda argv, **kw: seeded.update(argv=argv, **kw) or rr(0))
    sleeps = []
    monkeypatch.setattr(ph.time, "sleep", lambda s: sleeps.append(s))
    stops = []

    def fake_sb_run(self, script, payload, extra=None, timeout=60, cwd=None):
        stops.append((script, payload))
        # the first five Stops block; afterwards the breaker disables the gate (empty output)
        if len(stops) == 1:
            (self.atlas / "hookstate").mkdir(exist_ok=True)
            (self.atlas / "hookstate" / "s1.json").write_text('{"breaker_tripped": true}')
        return rr(0, out=json.dumps({"decision": "block", "reason": "r"}) if len(stops) <= 5 else "")

    monkeypatch.setattr(ph.Sandbox, "run", fake_sb_run)
    m = byname(ph.probe_completion_breaker(ctx))
    assert m["completion_gate_blocks_of_9"]["value"] == 5
    assert m["completion_gate_breaker_faults"]["value"] == 1
    assert len(stops) == 9 and sleeps == [2.2] * 9
    assert {s for s, _ in stops} == {"completion_gate.py"}
    sid = stops[0][1]["session_id"]
    assert all(p["session_id"] == sid and p["hook_event_name"] == "Stop" for _, p in stops)
    assert stops[0][1]["last_assistant_message"] == "ATLAS | s verify | x"
    # the seed script registers the same session as an orchestrating run with one edit
    code = seeded["argv"][2]
    assert repr(sid) in code and "mark_orchestrating" in code and "log_event" in code
    assert seeded["argv"][0] == ctx.py


# --- parse_summary / failing_ids / suite_metrics ----------------------------------------------------


def test_parse_summary_pytest_variants():
    assert ph.parse_summary("=== 10 passed, 2 failed, 3 skipped in 1.50s ===") == (10, 2, 3, 1.5)
    assert ph.parse_summary("=== 5 passed, 1 error in 0.20s ===") == (5, 1, 0, 0.2)
    assert ph.parse_summary("=== 3 failed, 4 errors in 2s ===") == (0, 7, 0, 2.0)
    assert ph.parse_summary("junk\n8 passed, 1 skipped in 0.30s\n") == (8, 0, 1, 0.3)
    assert ph.parse_summary("=== 2 passed, 1 warning in 0.1s ===") == (2, 0, 0, 0.1)


def test_parse_summary_unittest_variants():
    assert ph.parse_summary("Ran 10 tests in 0.500s\n\nOK") == (10, 0, 0, 0.5)
    assert ph.parse_summary("Ran 10 tests in 1.0s\n\nFAILED (failures=2, errors=1, skipped=3)") == (4, 3, 3, 1.0)
    assert ph.parse_summary("Ran 1 test in 0.1s\n\nOK (skipped=1)") == (0, 0, 1, 0.1)


def test_parse_summary_none_when_unrecognised():
    assert ph.parse_summary("") is None
    assert ph.parse_summary("nothing to see") is None


def test_failing_ids_formats_dedupe_and_cap():
    text = (
        "FAILED tests/a.py::t1 - AssertionError: x\n"
        "FAILED tests/a.py::t1\n"
        "ERROR tests/b.py::t2\n"
        "FAIL: test_c (mod.Case)\n"
        "ERROR: test_d (mod.Case)\n"
        "(fail) bun test name [1.0ms]\n"
        "  FAILED indented is not a match\n"
        "PASSED tests/ok.py\n"
    )
    assert ph.failing_ids(text) == [
        "tests/a.py::t1", "tests/b.py::t2", "test_c (mod.Case)", "test_d (mod.Case)", "bun test name [1.0ms]"]
    many = "\n".join(f"FAILED t{i}.py::x" for i in range(30))
    assert ph.failing_ids(many) == [f"t{i}.py::x" for i in range(ph.FAILED_CAP)]
    assert ph.FAILED_CAP == 20


def test_suite_metrics_ok_and_failures():
    r = {"rc": 1, "out": "FAILED a.py::t - boom\n=== 3 passed, 1 failed, 2 skipped in 4.00s ===", "err": ""}
    m = byname(ph.suite_metrics("hooks_suite", r, "cmd"))
    assert m["hooks_suite_pass"]["value"] == 3 and m["hooks_suite_pass"]["direction"] == "higher"
    assert m["hooks_suite_fail"]["value"] == 1 and m["hooks_suite_fail"]["detail"] == ["a.py::t"]
    assert m["hooks_suite_skipped"]["value"] == 2 and m["hooks_suite_skipped"]["direction"] == "info"
    assert m["hooks_suite_wall_s"]["value"] == 4.0 and m["hooks_suite_wall_s"]["direction"] == "info"
    assert {x["group"] for x in m.values()} == {"suites"}
    assert byname(ph.suite_metrics("x", r, "c", group="omp"))["x_pass"]["group"] == "omp"


def test_suite_metrics_reads_stderr_too():
    r = {"rc": 0, "out": "", "err": "Ran 4 tests in 0.1s\n\nOK"}
    assert byname(ph.suite_metrics("s", r, "c"))["s_pass"]["value"] == 4


@pytest.mark.parametrize("r", [
    {"rc": "TIMEOUT", "out": "=== 3 passed in 1s ===", "err": ""},
    {"rc": 1, "out": "garbage", "err": "more"},
])
def test_suite_metrics_timeout_or_unparseable_is_error(r):
    out = ph.suite_metrics("s", r, "c")
    assert len(out) == 1 and out[0]["name"] == "s_pass" and out[0]["state"] == "error"
    assert f"rc={r['rc']}" in out[0]["reason"]


def test_suite_metrics_error_reason_is_output_tail():
    r = {"rc": 2, "out": "HEAD" + "x" * 300, "err": "TAIL"}
    reason = ph.suite_metrics("s", r, "c")[0]["reason"]
    assert reason.endswith("TAIL") and "HEAD" not in reason


# --- _py_suite ---------------------------------------------------------------------------------------


def test_py_suite_prefers_pytest_when_importable(ctx, monkeypatch):
    calls = []

    def fake_run(argv, **kw):
        calls.append((argv, kw))
        if argv[1:] == ["-c", "import pytest"]:
            return rr(0)
        return rr(0, out="=== 7 passed in 1.00s ===")

    monkeypatch.setattr(ph, "run", fake_run)
    out = ph._py_suite(ctx, "hooks", ctx.hooks)
    assert calls[1][0] == [ctx.py, "-m", "pytest", "-q", "-p", "no:cacheprovider", "."]
    assert calls[1][1]["cwd"] == str(ctx.hooks) and calls[1][1]["timeout"] == 1800
    m = byname(out)
    assert m["hooks_suite_pass"]["value"] == 7
    assert m["hooks_suite_pass"]["remeasure"] == f"cd {ctx.hooks} && python3 -m pytest -q -p no:cacheprovider ."


def test_py_suite_falls_back_to_unittest(ctx, monkeypatch):
    calls = []

    def fake_run(argv, **kw):
        calls.append(argv)
        if argv[1:] == ["-c", "import pytest"]:
            return rr(1)
        return rr(0, err="Ran 3 tests in 0.1s\n\nOK")

    monkeypatch.setattr(ph, "run", fake_run)
    m = byname(ph._py_suite(ctx, "scripts", ctx.scripts))
    assert calls[1] == [ctx.py, "-W", "ignore", "-m", "unittest", "discover", "-p", "test_*.py"]
    assert m["scripts_suite_pass"]["value"] == 3


def test_suite_probes_target_their_directories(ctx, monkeypatch):
    seen = []
    monkeypatch.setattr(ph, "_py_suite", lambda c, name, d: seen.append((name, d)) or [])
    ph.probe_hook_suite(ctx)
    ph.probe_scripts_suite(ctx)
    assert seen == [("hooks", ctx.hooks), ("scripts", ctx.scripts)]


def test_registry():
    names = [p[0] for p in ph.PROBES]
    assert names == ["hook_latency", "failopen_grid", "hook_drift", "bash_advisor_scaling",
                     "completion_breaker", "hook_suite", "scripts_suite"]
    assert [p[3] for p in ph.PROBES] == [False, True, False, False, True, True, True]
    assert dict((p[0], p[2]) for p in ph.PROBES)["failopen_grid"] == [
        "failopen_crashes", "failopen_timeouts", "failopen_untraced"]
    assert ph.CMD.endswith("--only ")
