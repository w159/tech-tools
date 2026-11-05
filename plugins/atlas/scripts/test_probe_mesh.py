"""probe_mesh: the probes' own logic with the live boundaries (helper subprocesses, tmux, spawn
processes) stubbed. Nothing here starts tmux or a real agent."""

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
from scorecard import core  # noqa: E402
from scorecard import probe_mesh as pm  # noqa: E402

ROOT = HERE.parent


@pytest.fixture
def ctx(tmp_path):
    c = core.Ctx(ROOT, quick=False, work=str(tmp_path / "w"))
    c.tmux_real = None
    yield c
    c.close()


def byname(ms):
    return {m["name"]: m for m in ms}


# --- embedded helper sources are valid python -------------------------------


@pytest.mark.parametrize(
    "src", [pm.BOARD_PY, pm.FAKE_INTERACTIVE, pm.FAKE_WORKER, pm.IRC_PY, pm.COLONY_PY]
)
def test_embedded_sources_parse(src):
    ast.parse(src)


# --- _helper ----------------------------------------------------------------


def test_helper_parses_sc_result_and_sets_env(ctx):
    code = (
        "import os, json\n"
        "print('noise')\n"
        "print('SC_RESULT ' + json.dumps({'s': os.environ['SC_SCRIPTS'], 'h': os.environ['SC_HOOKS'],"
        " 'x': os.environ.get('EXTRA'), 'cwd': os.getcwd()}))\n"
        "print('trailing')\n"
    )
    res, r = pm._helper(ctx, "hlp", code, dict(os.environ), 30, {"EXTRA": "1"})
    assert res["s"] == str(ctx.scripts) and res["h"] == str(ctx.hooks) and res["x"] == "1"
    assert res["cwd"] == str(ctx.work / "hlp")
    assert r["rc"] == 0
    assert (ctx.work / "hlp" / "helper.py").read_text() == code


def test_helper_none_without_result(ctx):
    res, r = pm._helper(ctx, "hlp", "print('nothing')", dict(os.environ))
    assert res is None and "nothing" in r["out"]


def test_helper_timeout_reported(ctx):
    res, r = pm._helper(ctx, "hlp", "import time; time.sleep(5)", dict(os.environ), 0.3)
    assert res is None and r["rc"] == "TIMEOUT"


def test_helper_extra_overrides_base(ctx):
    code = "import os,json;print('SC_RESULT '+json.dumps(os.environ['SC_SCRIPTS']))"
    res, _ = pm._helper(ctx, "hlp", code, dict(os.environ), 30, {"SC_SCRIPTS": "mine"})
    assert res == "mine"


# --- probe_board ------------------------------------------------------------


GOOD_BOARD = {
    "same_file_parsed": 795,
    "own_file_parsed": 800,
    "adds_parsed": 190,
    "stream_expected": 2400,
    "stream_lost": 3,
    "stream_dup": 1,
    "late_note_delivered": 1,
}


def test_probe_board_metrics(ctx, monkeypatch):
    seen = {}

    def helper(c, name, code, env, timeout=300, extra=None):
        seen.update(name=name, code=code, timeout=timeout, extra=extra, env=env)
        return GOOD_BOARD, {"rc": 0, "out": "", "err": ""}

    monkeypatch.setattr(pm, "_helper", helper)
    ms = pm.probe_board(ctx)
    assert [m["name"] for m in ms] == [
        "board_note_loss_same_file",
        "board_note_loss_own_file",
        "board_add_loss",
        "irc_stream_loss",
        "irc_stream_dup",
        "irc_late_note_delivered",
    ]
    d = byname(ms)
    assert (d["board_note_loss_same_file"]["value"], d["board_note_loss_same_file"]["unit"]) == (5, "of 800")
    assert (d["board_note_loss_own_file"]["value"], d["board_note_loss_own_file"]["unit"]) == (0, "of 800")
    assert (d["board_add_loss"]["value"], d["board_add_loss"]["unit"]) == (10, "of 200")
    assert (d["irc_stream_loss"]["value"], d["irc_stream_loss"]["unit"]) == (3, "of 2400")
    assert d["irc_stream_loss"]["threshold"] == {"abs": 8}
    assert d["irc_stream_loss"]["deterministic"] is False
    assert d["irc_stream_dup"]["value"] == 1 and d["irc_stream_dup"]["unit"] == "notes"
    late = d["irc_late_note_delivered"]
    assert late["value"] == 1 and late["direction"] == "higher" and late["unit"] == "of 1"
    for m in ms:
        assert m["group"] == "mesh" and m["state"] == "ok"
        assert m["remeasure"] == pm.CMD + "board_concurrency"
    assert seen["name"] == "board" and seen["code"] is pm.BOARD_PY and seen["timeout"] == 300
    assert seen["extra"] == {"SC_ROOT": str(ctx.work / "board" / "proj")}
    assert (ctx.work / "board" / "proj").is_dir()
    assert seen["env"]["HOME"].endswith("board/home")


def test_probe_board_helper_failure_marks_all_errors(ctx, monkeypatch):
    monkeypatch.setattr(
        pm, "_helper", lambda *a, **k: (None, {"rc": 1, "out": "o" * 400, "err": "boom"})
    )
    ms = pm.probe_board(ctx)
    assert len(ms) == 6
    for m in ms:
        assert m["state"] == "error" and m["group"] == "mesh" and m["value"] is None
        assert m["reason"].startswith("board helper failed: ")
        assert m["reason"].endswith("o" * 100) and len(m["reason"]) == len("board helper failed: ") + 250
    assert "boom" not in ms[0]["reason"]  # tail-250 of err+out keeps only the out tail


# --- _tmux / _fake_panes ----------------------------------------------------


def test_tmux_uses_private_socket(ctx, monkeypatch):
    ctx.tmux_real = "/usr/bin/tmux"
    ctx.tmux_sock = "sockX"
    seen = {}

    class R:
        pass

    def run(argv, **kw):
        seen["argv"], seen["kw"] = argv, kw
        return R()

    monkeypatch.setattr(pm.subprocess, "run", run)
    assert isinstance(pm._tmux(ctx, "ls", "-a"), R)
    assert seen["argv"] == ["/usr/bin/tmux", "-L", "sockX", "ls", "-a"]
    assert seen["kw"] == {"capture_output": True, "text": True}


def test_fake_panes_creates_binaries_and_scripts(ctx):
    bindir, d = pm._fake_panes(ctx, {}, ctx.work, ctx.work)
    assert bindir == ctx.work / "mesh" / "bin" and d == ctx.work / "mesh"
    assert (bindir / "omp").exists() and (bindir / "claude").exists()
    assert (d / "fake_interactive.py").read_text() == pm.FAKE_INTERACTIVE
    assert (d / "fake_worker.py").read_text() == pm.FAKE_WORKER


def test_fake_panes_none_when_copy_cannot_run(ctx, monkeypatch):
    class R:
        returncode = 1

    monkeypatch.setattr(pm.subprocess, "run", lambda *a, **k: R())
    bindir, d = pm._fake_panes(ctx, {}, ctx.work, ctx.work)
    assert bindir is None and d == ctx.work / "mesh"
    assert not (d / "fake_interactive.py").exists()


def test_fake_panes_reuses_existing_binary(ctx, monkeypatch):
    d = ctx.work / "mesh" / "bin"
    d.mkdir(parents=True)
    (d / "omp").write_text("#!/bin/sh\nexit 0\n")
    (d / "omp").chmod(0o755)
    (d / "claude").write_text("keep")
    pm._fake_panes(ctx, {}, ctx.work, ctx.work)
    assert (d / "omp").read_text() == "#!/bin/sh\nexit 0\n"
    assert (d / "claude").read_text() == "keep"


# --- probe_irc --------------------------------------------------------------


def test_probe_irc_skipped_without_tmux(ctx):
    ms = pm.probe_irc(ctx)
    assert [m["name"] for m in ms] == [
        "irc_human_loss",
        "irc_human_dup",
        "irc_a2a_loss",
        "irc_shell_typed",
        "irc_stuck_queued",
    ]
    for m in ms:
        assert m["state"] == "skipped" and m["reason"] == "tmux not installed" and m["group"] == "mesh"


@pytest.fixture
def irc_env(ctx, monkeypatch):
    ctx.tmux_real = "/usr/bin/tmux"
    calls = []
    sleeps = []
    state = {"new_session_rc": 0, "capture_out": "", "bindir": None}

    class R:
        def __init__(self, rc=0, out=""):
            self.returncode, self.stdout = rc, out

    def tmux(c, *a):
        calls.append(a)
        if a[0] == "new-session":
            return R(state["new_session_rc"])
        if a[0] == "capture-pane":
            return R(0, state["capture_out"])
        return R()

    monkeypatch.setattr(pm, "_tmux", tmux)
    monkeypatch.setattr(pm.time, "sleep", lambda s: sleeps.append(s))
    state["calls"], state["sleeps"] = calls, sleeps
    runs = []
    monkeypatch.setattr(pm, "run", lambda argv, **kw: runs.append((argv, kw)) or {"rc": 0, "out": "", "err": ""})
    state["runs"] = runs

    def fake_panes(c, env, root, recv):
        d = c.sub("mesh")
        return (state["bindir"] if state["bindir"] is not None else d / "bin"), d

    monkeypatch.setattr(pm, "_fake_panes", fake_panes)
    return state


def _sent():
    return (
        [dict(tag=f"HM{i:03d}", cls="human", to="omp1", n=1, first_ms=10.0 + i, final="read") for i in range(4)]
        + [dict(tag="HM004", cls="human", to="wk1", n=0, first_ms=None, final="queued")]
        + [dict(tag="HM005", cls="human", to="omp2", n=2, first_ms=50.0, final="read")]
        + [dict(tag="HM006", cls="human", to="sh1", n=0, first_ms=None, final="refused")]
        + [dict(tag="AM000", cls="a2a", to="wk2", n=0), dict(tag="AM001", cls="a2a", to="wk2", n=1)]
    )


def test_probe_irc_metrics(ctx, irc_env, monkeypatch):
    seen = {}

    def helper(c, name, code, env, timeout=300, extra=None):
        seen.update(name=name, code=code, timeout=timeout, env=env)
        return _sent(), {"rc": 0, "out": "", "err": ""}

    monkeypatch.setattr(pm, "_helper", helper)
    irc_env["capture_out"] = "HM0 typed\nHM0 again"
    ms = pm.probe_irc(ctx)
    d = byname(ms)
    assert d["irc_human_sent"]["value"] == 6 and d["irc_human_sent"]["direction"] == "info"
    assert d["irc_human_loss"]["value"] == 1
    assert d["irc_human_dup"]["value"] == 1
    assert d["irc_a2a_loss"]["value"] == 1 and d["irc_a2a_loss"]["threshold"] == {"abs": 2}
    assert d["irc_shell_typed"]["value"] == 2
    assert d["irc_stuck_queued"]["value"] == 1 and d["irc_stuck_queued"]["threshold"] == {"abs": 2}
    assert d["irc_delivery_p50_ms"]["value"] == 13.0 or d["irc_delivery_p50_ms"]["value"] == 12.0
    assert d["irc_delivery_p95_ms"]["value"] == 50.0
    assert d["irc_delivery_p50_ms"]["detail"] == {"n": 5}
    for m in ms:
        assert m["group"] == "mesh" and m["remeasure"] == pm.CMD + "irc_delivery"
    assert seen["name"] == "irc" and seen["code"] is pm.IRC_PY and seen["timeout"] == 240
    assert seen["env"]["SC_N"] == "40" and seen["env"]["ATLAS_MUX"] == "tmux"
    assert seen["env"]["SC_ROOT"] == str(ctx.work / "irc" / "proj")
    assert seen["env"]["SC_RECV"] == str(ctx.work / "irc" / "recv")
    assert seen["env"]["ATLAS_PROJECT_ROOT"] == seen["env"]["SC_ROOT"]
    assert seen["env"]["SC_HOOKS"] == str(ctx.hooks)
    calls = irc_env["calls"]
    assert calls[0][:4] == ("new-session", "-d", "-s", "atlas-scirc")
    assert calls[-1] == ("kill-server",)
    assert ("capture-pane", "-p", "-t", "atlas-scirc:sh1") in calls
    names = [c[c.index("-n") + 1] for c in calls if c[0] == "new-window"]
    assert names == ["omp1", "omp2", "wk1", "wk2", "sh1"]
    assert 1.5 in irc_env["sleeps"]
    # lead-seeding python run targets the scripts dir and the same root
    (argv, kw), = irc_env["runs"]
    assert argv[:2] == [ctx.py, "-c"] and str(ctx.scripts) in argv[2] and "started '+n" in argv[2]
    assert str(ctx.work / "irc" / "proj") in argv[2] and "to='lead'" in argv[2]


def test_probe_irc_quick_uses_20_messages(irc_env, monkeypatch, tmp_path):
    q = core.Ctx(ROOT, quick=True, work=str(tmp_path / "wq"))
    q.tmux_real = "/usr/bin/tmux"
    seen = {}
    monkeypatch.setattr(pm, "_helper", lambda c, n, code, env, t=300, extra=None: (seen.update(env) or _sent(), {}))
    try:
        pm.probe_irc(q)
    finally:
        q.close()
    assert seen["SC_N"] == "20"


def test_probe_irc_pane_command_lines(ctx, irc_env, monkeypatch):
    monkeypatch.setattr(pm, "_helper", lambda *a, **k: (_sent(), {}))
    pm.probe_irc(ctx)
    wins = {c[c.index("-n") + 1]: c for c in irc_env["calls"] if c[0] == "new-window"}
    omp1 = wins["omp1"][-1]
    assert omp1.startswith("exec env ") and "FAKE_NAME=omp1" in omp1 and "ATLAS_WORKER_NAME=omp1" in omp1
    assert f"{ctx.py} {ctx.work / 'mesh'}/fake_interactive.py" in omp1
    assert str(ctx.work / "mesh" / "bin" / "omp") in omp1 and omp1.endswith("; true'")
    wk1 = wins["wk1"][-1]
    assert "fake_worker.py atlas_mux.py run-worker" in wk1 and "ATLAS_WORKER_NAME=wk1" in wk1
    assert "SC_RECV=" in omp1 and "ATLAS_DB=" in omp1 and "HOME=" in omp1
    assert wins["sh1"][-1] == "exec bash -c 'sleep 3000; true'"
    assert wins["omp1"][wins["omp1"].index("-t") + 1] == "atlas-scirc:"
    assert "-d" in wins["omp1"]


def test_probe_irc_no_latency_samples_skips_percentiles(ctx, irc_env, monkeypatch):
    res = [dict(tag="HM000", cls="human", to="omp1", n=0, first_ms=None, final="queued")]
    monkeypatch.setattr(pm, "_helper", lambda *a, **k: (res, {}))
    d = byname(pm.probe_irc(ctx))
    assert d["irc_delivery_p50_ms"]["state"] == "skipped"
    assert d["irc_human_loss"]["value"] == 1


def test_probe_irc_bindir_none_skips(ctx, irc_env, monkeypatch):
    monkeypatch.setattr(pm, "_fake_panes", lambda *a: (None, ctx.work))
    ms = pm.probe_irc(ctx)
    assert len(ms) == 5
    assert all(m["state"] == "skipped" and "copied bash named omp" in m["reason"] for m in ms)
    assert not irc_env["calls"]


def test_probe_irc_session_start_failure(ctx, irc_env):
    irc_env["new_session_rc"] = 1
    ms = pm.probe_irc(ctx)
    assert len(ms) == 5
    assert all(m["reason"] == "private tmux server would not start" and m["state"] == "skipped" for m in ms)
    assert not any(c[0] == "new-window" for c in irc_env["calls"])


def test_probe_irc_helper_failure(ctx, irc_env, monkeypatch):
    monkeypatch.setattr(pm, "_helper", lambda *a, **k: (None, {"out": "x", "err": "E" * 400}))
    ms = pm.probe_irc(ctx)
    assert len(ms) == 5
    for m in ms:
        assert m["state"] == "error" and m["reason"].startswith("irc helper failed: ")
        assert m["reason"].endswith("x") and len(m["reason"]) == len("irc helper failed: ") + 250
    assert irc_env["calls"][-1] == ("kill-server",)


# --- probe_colony -----------------------------------------------------------


def test_probe_colony_accuracy(ctx, monkeypatch):
    runs = []
    monkeypatch.setattr(pm, "run", lambda argv, **kw: runs.append((argv, kw)) or {"rc": 0, "out": "", "err": ""})
    got = {}

    def helper(c, name, code, env, timeout=300, extra=None):
        got.update(name=name, code=code, timeout=timeout, env=env)
        return (
            {"da": {"state": "finished"}, "db": {"state": "dead"}, "dc": {"state": "running"}},
            {},
        )

    monkeypatch.setattr(pm, "_helper", helper)
    (m,) = pm.probe_colony(ctx)
    assert m["name"] == "colony_terminal_accuracy" and m["value"] == 2
    assert m["unit"] == "of 3" and m["direction"] == "higher" and m["group"] == "mesh"
    assert m["detail"] == {"da": {"state": "finished"}, "db": {"state": "dead"}, "dc": {"state": "running"}}
    assert m["remeasure"] == pm.CMD + "colony_accuracy"
    assert got["name"] == "colony" and got["code"] is pm.COLONY_PY and got["timeout"] == 60
    assert got["env"]["SC_ROOT"] == str(ctx.work / "colony" / "proj")
    (argv, kw), = runs
    assert argv[:2] == [ctx.py, "-c"]
    assert "open_lead_channel" in argv[2] and "mark_finished(R, 'da', 0)" in argv[2]
    assert "mark_finished(R, 'db', 1)" in argv[2] and "set_member_handles" in argv[2]


def test_probe_colony_missing_members_count_zero(ctx, monkeypatch):
    monkeypatch.setattr(pm, "run", lambda *a, **k: {"rc": 0, "out": "", "err": ""})
    monkeypatch.setattr(pm, "_helper", lambda *a, **k: ({"da": None, "db": {}}, {}))
    (m,) = pm.probe_colony(ctx)
    assert m["value"] == 0 and m["detail"] == {"da": None, "db": {}, "dc": None}


def test_probe_colony_setup_failure(ctx, monkeypatch):
    monkeypatch.setattr(pm, "run", lambda *a, **k: {"rc": 1, "out": "o", "err": "setup broke"})
    (m,) = pm.probe_colony(ctx)
    assert m["state"] == "error" and m["name"] == "colony_terminal_accuracy"
    assert m["reason"] == "colony setup failed: setup brokeo"
    assert (m["unit"], m["direction"], m["group"], m["remeasure"]) == ("of 3", "higher", "mesh", pm.CMD + "colony_accuracy")


def test_probe_colony_no_route_is_skipped(ctx, monkeypatch):
    monkeypatch.setattr(pm, "run", lambda *a, **k: {"rc": 0, "out": "", "err": ""})
    monkeypatch.setattr(pm, "_helper", lambda *a, **k: ({"__no_route__": 1}, {}))
    (m,) = pm.probe_colony(ctx)
    assert m["state"] == "skipped"
    assert m["reason"] == "colony HTTP route absent in this tree: not measurable"


def test_probe_colony_helper_failure_is_error(ctx, monkeypatch):
    monkeypatch.setattr(pm, "run", lambda *a, **k: {"rc": 0, "out": "", "err": ""})
    monkeypatch.setattr(pm, "_helper", lambda *a, **k: (None, {"out": "O", "err": "E"}))
    (m,) = pm.probe_colony(ctx)
    assert m["state"] == "error" and m["reason"] == "colony helper failed: EO"


# --- probe_spawn ------------------------------------------------------------


def test_probe_spawn_skipped_without_tmux(ctx):
    (m,) = pm.probe_spawn(ctx)
    assert m["name"] == "parallel_spawn_ok" and m["state"] == "skipped"
    assert m["reason"] == "tmux not installed" and m["unit"] == "of 8" and m["direction"] == "higher"
    assert m["group"] == "mesh" and m["remeasure"] == pm.CMD + "parallel_spawn"


class FakeProc:
    def __init__(self, out, err="", boom=False):
        self.out, self.err = out, err

    def communicate(self, timeout=None):
        self.timeout = timeout
        return self.out, self.err


def test_probe_spawn_counts_ok(ctx, monkeypatch):
    ctx.tmux_real = "/usr/bin/tmux"
    popen = []
    outs = iter(
        [json.dumps({"ok": True})] * 5
        + [json.dumps({"ok": False, "error": "e" * 200}), "not json", json.dumps({"ok": False})]
    )

    def Popen(argv, **kw):
        p = FakeProc(next(outs), err="stderr-tail")
        popen.append((argv, kw, p))
        return p

    monkeypatch.setattr(pm.subprocess, "Popen", Popen)
    tm = []
    monkeypatch.setattr(pm, "_tmux", lambda c, *a: tm.append(a))
    (m,) = pm.probe_spawn(ctx)
    assert m["value"] == 5 and m["unit"] == "of 8" and m["direction"] == "higher"
    assert m["detail"] == sorted({"e" * 80, "stderr-tail", "stderr-tail"})
    assert tm == [("kill-server",)]
    assert len(popen) == 8
    for i, (argv, kw, p) in enumerate(popen):
        assert argv[:3] == [ctx.py, str(ctx.scripts / "atlas_mux.py"), "spawn"]
        assert argv[argv.index("--name") + 1] == f"w{i}"
        assert argv[argv.index("--run") + 1] == "scsp"
        assert argv[argv.index("--harness") + 1] == "claude"
        assert argv[argv.index("--agent") + 1] == "implementer"
        assert argv[argv.index("--root") + 1] == str(ctx.work / "spawn" / "proj")
        pf = argv[argv.index("--prompt-file") + 1]
        assert Path(pf).read_text() == "do work"
        assert kw["env"]["ATLAS_MUX_WORKER_CMD"] == "echo hi; sleep 40"
        assert kw["env"]["ATLAS_COLONY_TRANSPORT"] == "tmux" and kw["env"]["ATLAS_MUX"] == "tmux"
        assert kw["text"] is True and kw["stdout"] == subprocess.PIPE and kw["stderr"] == subprocess.PIPE
        assert p.timeout == 120


def test_probe_spawn_all_ok_has_empty_detail(ctx, monkeypatch):
    ctx.tmux_real = "/usr/bin/tmux"
    monkeypatch.setattr(pm.subprocess, "Popen", lambda *a, **k: FakeProc(json.dumps({"ok": True})))
    monkeypatch.setattr(pm, "_tmux", lambda *a: None)
    (m,) = pm.probe_spawn(ctx)
    assert m["value"] == 8 and m["detail"] == []


def test_registry():
    assert [(n, f, d, s) for n, f, d, s in pm.PROBES] == [
        ("board_concurrency", pm.probe_board, ["board_note_loss_same_file", "irc_stream_loss"], False),
        ("irc_delivery", pm.probe_irc, ["irc_human_loss", "irc_human_dup"], False),
        ("colony_accuracy", pm.probe_colony, ["colony_terminal_accuracy"], False),
        ("parallel_spawn", pm.probe_spawn, ["parallel_spawn_ok"], False),
    ]
