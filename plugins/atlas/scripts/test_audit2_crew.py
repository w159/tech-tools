"""Crew defects of run crew-1649305f31: a lease stuck on an exited worker, wait cycles in `needs`, `plan --plan`."""

import io
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
SCRIPTS = PLUGIN / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(PLUGIN / "hooks"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_crew  # noqa: E402
import atlas_irc as irc  # noqa: E402
import crew_worker  # noqa: E402


def _plan(tmp_path, workers):
    p = tmp_path / "plan.json"
    p.write_text(json.dumps({"goal": "g", "workers": workers}))
    return p


def _w(name, needs=None, auto=None):
    w = {"name": name, "owns": [f"{name}.py"], "task": "t", "check": "python3 -m pytest -q"}
    if needs is not None:
        w["needs"] = needs
    if auto is not None:
        w["auto_needs"] = auto
    return w


def test_automatic_edge_closing_a_cycle_is_dropped(tmp_path):
    p = _plan(tmp_path, [_w("a", ["b"], ["b"]), _w("b", ["c"], ["c"]), _w("c", ["a"], ["a"])])
    plan = atlas_crew.load_plan(p)
    by = {w["name"]: w["needs"] for w in plan["workers"]}
    assert by == {"a": ["b"], "b": ["c"], "c": []}
    assert plan["dropped_needs"] == [["c", "a"]]


def test_explicit_edges_are_kept_and_an_explicit_cycle_is_rejected(tmp_path):
    p = _plan(tmp_path, [_w("a", ["b"]), _w("b", ["a"], ["a"])])
    plan = atlas_crew.load_plan(p)
    assert {w["name"]: w["needs"] for w in plan["workers"]} == {"a": ["b"], "b": []}
    p = _plan(tmp_path, [_w("a", ["b"]), _w("b", ["a"])])
    with pytest.raises(ValueError, match="cycle"):
        atlas_crew.load_plan(p)


def test_acyclic_plan_has_no_dropped_needs(tmp_path):
    plan = atlas_crew.load_plan(_plan(tmp_path, [_w("a", ["b"], ["b"]), _w("b")]))
    assert "dropped_needs" not in plan


def test_plan_subcommand_accepts_plan_and_prints_resolved_needs(tmp_path):
    p = _plan(tmp_path, [_w("a", ["b"], ["b"]), _w("b", ["a"], ["a"]), _w("c")])
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = atlas_crew.main(["plan", "--plan", str(p), "--root", str(tmp_path)])
    assert rc == 0
    out = json.loads(buf.getvalue())
    assert out["workers"][0]["check"] == "irc check"
    assert [w["needs"] for w in out["workers"]] == [["b"], [], []]
    assert out["dropped_needs"] == [["b", "a"]]


def test_plan_subcommand_reports_a_bad_plan(tmp_path):
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = atlas_crew.main(["plan", "--plan", str(tmp_path / "missing.json")])
    assert rc == 2 and json.loads(buf.getvalue())["ok"] is False


def test_prompt_tells_a_worker_without_needs_not_to_wait_and_names_claim(tmp_path):
    plan = atlas_crew.load_plan(_plan(tmp_path, [_w("a"), _w("b", ["a"], ["a"])]))
    pa = atlas_crew.worker_prompt(plan, plan["workers"][0], "run1", str(tmp_path))
    pb = atlas_crew.worker_prompt(plan, plan["workers"][1], "run1", str(tmp_path))
    assert "waits for no peer" in pa and "after the peers you import" not in pa
    assert "after the peers you import are done" in pb
    assert "irc claim <path>" in pa


def test_hook_deny_names_claim_for_an_exited_owner(tmp_path, monkeypatch, capsys):
    for k in list(os.environ):
        if k.startswith("ATLAS_IRC_") or k.startswith("ATLAS_CREW_"):
            monkeypatch.delenv(k)
    run = tmp_path / "run"
    d = irc.init_bus(run / "irc", "#run", ["gone", "me"], "lead")
    (run / "exit").mkdir()
    (run / "exit" / "gone.r0.json").write_text("{}")
    root = tmp_path / "repo"
    root.mkdir()
    monkeypatch.setenv("ATLAS_IRC_DIR", str(d))
    monkeypatch.setenv("ATLAS_IRC_NICK", "me")
    monkeypatch.setenv("ATLAS_CREW_ROOT", str(root))
    monkeypatch.setenv("ATLAS_CREW_OWNS", json.dumps(["mine.py"]))
    monkeypatch.setenv("ATLAS_CREW_OWNERS", json.dumps({"mine.py": "me", "t.py": "gone"}))
    crew_worker.pre_tool_use({"tool_name": "Edit", "tool_input": {"file_path": str(root / "t.py")}})
    out = capsys.readouterr().out
    assert '"deny"' in out and "irc claim t.py" in out and "has exited" in out
    crew_worker.pre_tool_use({"tool_name": "Bash", "tool_input": {"command": "echo x > t.py"}})
    assert "irc claim t.py" in capsys.readouterr().out
