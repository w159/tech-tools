"""probe_connectors: boot-without-credentials, boot harness and configured-truth probes. node/uv and the
child processes are external, so `run` and `shutil.which` are stubbed; service discovery, venv choice,
result parsing, the actionable-status regex and metric arithmetic run for real on fixture trees."""

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
from scorecard import core  # noqa: E402
from scorecard import probe_connectors as pc  # noqa: E402


def byname(ms):
    return {m["name"]: m for m in ms}


def rr(rc=0, out="", err="", ms=1.0):
    return {"rc": rc, "out": out, "err": err, "ms": ms}


@pytest.fixture
def ctx(tmp_path):
    root = tmp_path / "repo" / "plugins" / "atlas"
    root.mkdir(parents=True)
    c = core.Ctx(root, quick=True, work=str(tmp_path / "w"))
    c.tmux_real = None
    return c


def make_services(ctx, names, falcon_venv=None):
    mcp = ctx.root.parent / "armada" / "mcp"
    mcp.mkdir(parents=True)
    for n in names:
        d = mcp / n
        d.mkdir()
        if n != "falcon":
            (d / "server.mjs").write_text("")
    (mcp / "_env").mkdir()
    (mcp / "noserver").mkdir()  # directory with no server.mjs: not a service
    (mcp / "stray.txt").write_text("")
    if falcon_venv:
        (mcp / "falcon").mkdir(exist_ok=True)
        (mcp / "falcon" / falcon_venv).mkdir()
    return mcp


def result_line(res):
    return "log\nSC_RESULT " + json.dumps(res) + "\n"


def svc(ready, tools=3, status_ok=None, status="", runs=None):
    runs = runs or len(ready)
    return {"ready": ready, "total": ready, "tools": tools, "status_ok": runs if status_ok is None else status_ok,
            "runs": runs, "status": status}


# --- discovery -----------------------------------------------------------------------


def test_services_lists_dirs_with_server_or_falcon_sorted(ctx):
    make_services(ctx, ["zeta", "alpha", "falcon"])
    assert pc._services(ctx) == ["alpha", "falcon", "zeta"]


def test_falcon_venv_prefers_nosync_then_plain_then_none(ctx):
    make_services(ctx, ["a"])
    fal = ctx.root.parent / "armada" / "mcp" / "falcon"
    fal.mkdir()
    assert pc._falcon_venv(ctx) is None
    (fal / ".venv").mkdir()
    assert pc._falcon_venv(ctx) == ".venv"
    (fal / ".venv.nosync.noindex").mkdir()
    assert pc._falcon_venv(ctx) == ".venv.nosync.noindex"


# --- probe_nocreds_boot --------------------------------------------------------------


def test_boot_without_node_skips_all_three_metrics(ctx, monkeypatch):
    monkeypatch.setattr(pc.shutil, "which", lambda n: None)
    out = pc.probe_nocreds_boot(ctx)
    assert [o["name"] for o in out] == [
        "connector_boot_count", "connector_status_reachable", "connector_nocreds_actionable_rate"]
    assert {o["state"] for o in out} == {"skipped"}
    assert {o["reason"] for o in out} == {"node not installed"}


def test_boot_failure_to_produce_result_is_error_on_each_metric(ctx, monkeypatch):
    make_services(ctx, ["a"])
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/" + n)
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(1, "OUT", "ERR"))
    out = pc.probe_nocreds_boot(ctx)
    assert len(out) == 3
    assert all(o["state"] == "error" for o in out)
    assert all(o["reason"] == "connector probe failed: ERROUT" for o in out)


def test_boot_command_env_and_sample_count(ctx, monkeypatch):
    make_services(ctx, ["a", "b"])
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/" + n)
    seen = {}

    def fake_run(argv, **kw):
        seen.update(argv=argv, **kw)
        return rr(0, result_line({"a": svc([1.0] * 3), "b": svc([1.0] * 3)}))

    monkeypatch.setattr(pc, "run", fake_run)
    pc.probe_nocreds_boot(ctx)
    assert seen["argv"][0] == "/bin/node"
    assert seen["argv"][2:] == ["a", "b"]
    assert Path(seen["argv"][1]).read_text() == pc.PROBE_MJS
    e = seen["env"]
    assert e["SC_N"] == "3"  # quick mode
    assert e["SC_PLUGIN"] == str(ctx.root.parent / "armada")
    assert e["SC_FALCON_VENV"] == ".venv.nosync.noindex"  # default when no venv exists
    assert seen["timeout"] == 900
    ctx.quick = False
    pc.probe_nocreds_boot(ctx)
    assert seen["env"]["SC_N"] == "8"


def test_boot_metrics_from_results(ctx, monkeypatch):
    make_services(ctx, ["a", "b", "c"])
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/" + n)
    res = {
        "a": svc([10.0, 20.0, 30.0], tools=4, status="Set GITHUB_TOKEN to enable"),
        "b": svc([5.0, 5.0, 5.0], tools=0, status_ok=2, status='{"ok": true}'),
        "c": svc([7.0, 7.0, 7.0], tools=6, status="TIMEOUT"),
    }
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(0, result_line(res)))
    m = byname(pc.probe_nocreds_boot(ctx))
    assert m["connector_count"]["value"] == 3 and m["connector_count"]["direction"] == "info"
    assert m["connector_boot_count"]["value"] == 2  # tools > 0: a, c
    assert m["connector_nocreds_tools"]["value"] == 10
    assert m["connector_status_reachable"]["value"] == 2  # a and c answered every run; b missed one
    assert m["connector_nocreds_status_ok_true"]["value"] == 1
    assert m["connector_nocreds_actionable_rate"]["value"] == round(1 / 3, 3)
    assert m["connector_nocreds_actionable_rate"]["direction"] == "higher"
    assert m["connector_a_ready_p50_ms"]["value"] == 20.0
    assert m["connector_a_ready_p50_ms"]["detail"] == {"n": 3, "p95": 30.0}
    assert m["connector_ready_all_p50_ms"]["value"] == 7.0
    assert "connector_falcon_ready_p50_ms" not in m


@pytest.mark.parametrize(
    "status,expected",
    [
        ("Set SLACK_BOT_TOKEN first", 1),
        ("not configured", 1),
        ("Missing key", 1),
        ("this is REQUIRED", 1),
        ("set env vars", 1),
        ("set the env", 1),
        ("no credential found", 1),
        ("everything fine", 0),
        ("", 0),
        ("TIMEOUT", 0),
    ],
)
def test_actionable_status_detection(ctx, monkeypatch, status, expected):
    make_services(ctx, ["a"])
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/" + n)
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(0, result_line({"a": svc([1.0], status=status)})))
    m = byname(pc.probe_nocreds_boot(ctx))
    assert m["connector_nocreds_actionable_rate"]["value"] == expected


def test_status_ok_true_counts_only_json_objects_with_ok_true(ctx, monkeypatch):
    make_services(ctx, ["a"])
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/" + n)
    res = {
        "a": svc([1.0], status='{"ok": true}'),
        "b": svc([1.0], status='{"ok": false}'),
        "c": svc([1.0], status='{"ok": "true"}'),
        "d": svc([1.0], status="[true]"),
        "e": svc([1.0], status="not json"),
        "f": svc([1.0], status=None),
    }
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(0, result_line(res)))
    m = byname(pc.probe_nocreds_boot(ctx))
    assert m["connector_nocreds_status_ok_true"]["value"] == 1


def test_falcon_skipped_without_uv(ctx, monkeypatch):
    make_services(ctx, ["a", "falcon"], falcon_venv=".venv")
    monkeypatch.setattr(pc.shutil, "which", lambda n: None if n == "uv" else "/bin/" + n)
    seen = {}
    monkeypatch.setattr(pc, "run", lambda argv, **kw: seen.setdefault("argv", argv) and rr(0, result_line({"a": svc([1.0])})))
    m = byname(pc.probe_nocreds_boot(ctx))
    assert "falcon" not in seen["argv"]
    assert m["connector_falcon_ready_p50_ms"]["state"] == "skipped"
    assert m["connector_falcon_ready_p50_ms"]["reason"] == "uv not installed"


def test_falcon_skipped_without_venv_and_run_when_present(ctx, monkeypatch):
    make_services(ctx, ["a", "falcon"])
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/" + n)
    calls = []
    monkeypatch.setattr(pc, "run", lambda argv, **kw: calls.append((argv, kw)) or rr(0, result_line({"a": svc([1.0])})))
    m = byname(pc.probe_nocreds_boot(ctx))
    assert "no falcon venv" in m["connector_falcon_ready_p50_ms"]["reason"]
    assert "falcon" not in calls[0][0]
    # with a venv, falcon is probed and no skip metric is emitted
    (ctx.root.parent / "armada" / "mcp" / "falcon" / ".venv").mkdir()
    m2 = byname(pc.probe_nocreds_boot(ctx))
    assert "falcon" in calls[1][0]
    assert calls[1][1]["env"]["SC_FALCON_VENV"] == ".venv"
    assert "connector_falcon_ready_p50_ms" not in m2


# --- probe_boot_harness -----------------------------------------------------------------


def test_harness_skipped_when_script_or_node_missing(ctx, monkeypatch):
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/node")
    out = pc.probe_boot_harness(ctx)  # harness file absent
    assert [o["name"] for o in out] == ["boot_harness_rc", "boot_harness_tools"]
    assert {o["state"] for o in out} == {"skipped"}
    (ctx.repo / "test-mcp-tools.mjs").write_text("")
    monkeypatch.setattr(pc.shutil, "which", lambda n: None)
    assert {o["state"] for o in pc.probe_boot_harness(ctx)} == {"skipped"}


@pytest.fixture
def harness(ctx, monkeypatch):
    (ctx.repo / "test-mcp-tools.mjs").write_text("")
    monkeypatch.setattr(pc.shutil, "which", lambda n: "/bin/node")
    return ctx


def test_harness_uses_last_line_total_when_present(harness, monkeypatch):
    seen = {}

    def fake_run(argv, **kw):
        seen.update(argv=argv, **kw)
        return rr(0, "a: 5 tools\nb: 7 tools\nALL: 12 tools\n")

    monkeypatch.setattr(pc, "run", fake_run)
    m = byname(pc.probe_boot_harness(harness))
    assert m["boot_harness_tools"]["value"] == 12
    assert m["boot_harness_rc"]["value"] == 0
    assert m["boot_harness_fail_lines"]["value"] == 0
    assert seen["argv"] == ["/bin/node", str(harness.repo / "test-mcp-tools.mjs")]
    assert seen["cwd"] == str(harness.repo)
    assert seen["timeout"] == 600


def test_harness_sums_per_service_counts_when_last_line_has_none(harness, monkeypatch):
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(0, "a: 5 tools\nb: 7 tools\ndone\n"))
    assert byname(pc.probe_boot_harness(harness))["boot_harness_tools"]["value"] == 12


def test_harness_counts_fail_words_and_nonzero_rc(harness, monkeypatch):
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(3, "FAIL one\nok\nFAIL two", "FAILURE FAIL\nFAILED"))
    m = byname(pc.probe_boot_harness(harness))
    assert m["boot_harness_rc"]["value"] == 1
    assert m["boot_harness_fail_lines"]["value"] == 3  # whole-word FAIL only (not FAILURE / FAILED)


def test_harness_empty_output_has_zero_tools(harness, monkeypatch):
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(0, "", ""))
    m = byname(pc.probe_boot_harness(harness))
    assert m["boot_harness_tools"]["value"] == 0
    assert m["boot_harness_tools"]["direction"] == "info"


# --- probe_configured_truth ---------------------------------------------------------------


def test_configured_truth_metrics(ctx, monkeypatch):
    seen = {}

    def fake_run(argv, **kw):
        seen.update(argv=argv, **kw)
        return rr(0, "x\nSC_RESULT " + json.dumps({"false_positive": ["auvik", "cipp"], "false_negative": ["panos"], "connectors": 20}))

    monkeypatch.setattr(pc, "run", fake_run)
    m = byname(pc.probe_configured_truth(ctx))
    fp, fn = m["connector_configured_false_positive"], m["connector_configured_false_negative"]
    assert (fp["value"], fp["detail"], fp["direction"]) == (2, ["auvik", "cipp"], "lower")
    assert (fn["value"], fn["detail"]) == (1, ["panos"])
    assert Path(seen["argv"][1]).read_text() == pc.CONFIG_PY
    assert seen["env"]["SC_SCRIPTS"] == str(ctx.scripts)
    assert seen["timeout"] == 120


def test_configured_truth_failure_is_error_pair(ctx, monkeypatch):
    monkeypatch.setattr(pc, "run", lambda *a, **k: rr(1, "", "Traceback X"))
    out = pc.probe_configured_truth(ctx)
    assert [o["name"] for o in out] == ["connector_configured_false_positive", "connector_configured_false_negative"]
    assert all(o["state"] == "error" and "dashboard connector status unavailable: Traceback X" in o["reason"] for o in out)


def test_embedded_sources_and_registry():
    import ast
    ast.parse(pc.CONFIG_PY)
    assert "SC_RESULT" in pc.PROBE_MJS
    assert [p[0] for p in pc.PROBES] == ["connector_boot", "boot_harness", "connector_configured_truth"]
    assert all(p[3] is False for p in pc.PROBES)
    assert dict((p[0], p[2]) for p in pc.PROBES)["connector_boot"] == ["connector_boot_count", "connector_status_reachable"]
