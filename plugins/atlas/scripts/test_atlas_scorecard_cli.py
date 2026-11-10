import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
import atlas_scorecard as sc  # noqa: E402
from scorecard import core  # noqa: E402

ROOT = HERE.parent


# --- _fmt -------------------------------------------------------------------


@pytest.mark.parametrize(
    "v,exp",
    [
        (None, "-"),
        (0, "0"),
        (3, "3"),
        (2.0, "2"),
        (1.5, "1.5"),
        (0.3333333, "0.333"),
        (10.0, "10"),
        (100.0, "100"),
        (0.0, "0"),
        ("txt", "txt"),
        (True, "True"),
    ],
)
def test_fmt(v, exp):
    assert sc._fmt(v) == exp


# --- _git_sha / _error_metric / load_probes --------------------------------


def test_git_sha_matches_git(tmp_path):
    def g(*a):
        subprocess.run(["git", "-C", str(tmp_path), *a], check=True, capture_output=True)

    g("init", "-q")
    g("config", "user.email", "t@t")
    g("config", "user.name", "t")
    g("commit", "--allow-empty", "-qm", "c")
    want = subprocess.run(
        ["git", "-C", str(tmp_path), "rev-parse", "--short", "HEAD"],
        capture_output=True,
        text=True,
    ).stdout.strip()
    assert want and sc._git_sha(tmp_path) == want


def test_git_sha_none_without_repo_or_git(tmp_path, monkeypatch):
    assert sc._git_sha(tmp_path) is None  # empty stdout -> None, not ""

    def boom(*a, **k):
        raise OSError("no git")

    monkeypatch.setattr(sc.subprocess, "run", boom)
    assert sc._git_sha(tmp_path) is None


def test_git_sha_call_shape(tmp_path, monkeypatch):
    seen = {}

    class R:
        stdout = " abc123\n"

    def run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        return R()

    monkeypatch.setattr(sc.subprocess, "run", run)
    assert sc._git_sha(tmp_path) == "abc123"
    assert seen["cmd"] == ["git", "-C", str(tmp_path), "rev-parse", "--short", "HEAD"]
    assert seen["kw"] == {"capture_output": True, "text": True, "timeout": 10}


def test_error_metric_shape():
    m = sc._error_metric("p", "msg", "probe")
    assert m["name"] == "probe_error.p"
    assert m["reason"] == "msg"
    assert m["state"] == "error"
    assert m["group"] == "probe"
    assert m["direction"] == "exact"
    assert m["remeasure"] == "--only p"
    assert m["value"] is None


def test_load_probes_shape_and_order():
    probes = sc.load_probes()
    assert probes
    for name, (fn, declared, mod, slow) in probes.items():
        assert callable(fn) and isinstance(declared, (list, tuple))
        assert mod in sc.PROBE_MODULES
        assert isinstance(slow, bool) or slow in (0, 1)
    mods = [v[2] for v in probes.values()]
    order = [sc.PROBE_MODULES.index(m) for m in mods]
    assert order == sorted(order)
    assert "mesh" in mods and "hooks" in mods


# --- run_probe extras ------------------------------------------------------


@pytest.fixture
def ctx(tmp_path):
    c = core.Ctx(ROOT, quick=True, work=str(tmp_path / "w"))
    yield c
    c.close()


def test_run_probe_timeout_becomes_error(ctx):
    def slow(_c):
        time.sleep(5)
        return []

    t0 = time.time()
    res, wall = sc.run_probe("slow", slow, ["decl"], ctx, 1, budget=0.2)
    assert time.time() - t0 < 3
    assert res["probe_error.slow"]["state"] == "error"
    assert res["probe_error.slow"]["reason"] == "timeout: probe exceeded its 0.2s budget"
    assert res["decl"]["state"] == "error"
    assert "probe slow crashed: timeout" in res["decl"]["reason"]
    assert wall > 0


def test_run_probe_timer_disarmed_after_run(ctx):
    import signal

    sc.run_probe("p", lambda _c: [core.metric("n", 1, "u")], [], ctx, 1)
    assert signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0)


def test_run_probe_repeat_zero_runs_once(ctx):
    calls = []

    def p(_c):
        calls.append(1)
        return [core.metric("n", 1, "u")]

    res, _ = sc.run_probe("p", p, [], ctx, 0)
    assert len(calls) == 1 and res["n"]["value"] == 1


def test_run_probe_unstable_non_numeric_has_no_variance(ctx):
    vals = iter(["a", "b"])
    res, _ = sc.run_probe("p", lambda _c: [core.metric("n", next(vals), "u")], [], ctx, 2)
    assert res["n"]["state"] == "unstable"
    assert res["n"]["detail"]["observed"] == ["a", "b"]
    assert res["n"]["detail"]["variance"] is None


def test_run_probe_two_timing_repeats_pick_upper_median(ctx):
    calls = iter([10.0, 20.0])
    res, _ = sc.run_probe("p", lambda _c: [core.timing("t", next(calls))], [], ctx, 2)
    assert res["t"]["value"] == 20.0


def test_run_probe_error_text_truncated(ctx):
    def boom(_c):
        raise RuntimeError("E" * 1000)

    res, _ = sc.run_probe("p", boom, ["d"], ctx, 1)
    assert len(res["probe_error.p"]["reason"]) == 400
    assert res["d"]["reason"] == "probe p crashed: " + res["probe_error.p"]["reason"][-200:]


def test_run_probe_merges_metric_only_in_later_run(ctx):
    n = iter([1, 2])

    def p(_c):
        i = next(n)
        return [core.metric("always", 1, "u")] + ([core.metric("late", 5, "u")] if i == 2 else [])

    res, _ = sc.run_probe("p", p, [], ctx, 2)
    assert res["late"]["value"] == 5 and res["always"]["state"] == "ok"


# --- cmd_diff / main -------------------------------------------------------


def _doc(path, metrics):
    Path(path).write_text(json.dumps({"metrics": {m["name"]: m for m in metrics}}))


def test_diff_table_format(tmp_path, capsys):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    _doc(a, [core.metric("alpha_long_name", 1.5, "ms"), core.metric("gone", 2, "")])
    _doc(b, [core.metric("alpha_long_name", 4.0, "ms", direction="higher"), core.metric("fresh", 7, "n")])
    rc = sc.main(["diff", str(a), str(b)])
    out = capsys.readouterr().out.splitlines()
    assert rc == 1
    w = len("alpha_long_name")
    assert out[0] == f"{'metric':{w}}  {'before':>12}  {'after':>12}  {'delta':>10}  verdict"
    rows = {ln.split()[0]: ln for ln in out[1:-1]}
    assert rows["alpha_long_name"] == f"{'alpha_long_name':{w}}  {'1.5':>12}  {'4':>12}  {'2.5':>10}  regressed  [ms]"
    assert rows["fresh"] == f"{'fresh':{w}}  {'-':>12}  {'7':>12}  {'-':>10}  new  [n]"
    assert rows["gone"].endswith("regressed  metric missing in after")
    assert rows["gone"].split()[1:3] == ["2", "-"]
    assert out[-1] == "summary: new=1, regressed=2"


def test_diff_unit_taken_from_before_when_after_missing_unit(tmp_path, capsys):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    _doc(a, [core.metric("m", 1, "sec")])
    _doc(b, [core.metric("m", 1, "")])
    sc.main(["diff", str(a), str(b)])
    out = capsys.readouterr().out
    assert "same  [sec]" in out


def test_diff_quiet_no_regressions_prints_summary_only(tmp_path, capsys):
    a = tmp_path / "a.json"
    _doc(a, [core.metric("m", 1, "")])
    assert sc.main(["diff", str(a), str(a), "--quiet"]) == 0
    assert capsys.readouterr().out == "summary: same=1\n"


def test_diff_quiet_with_regression_prints_table_and_only_regressed(tmp_path, capsys):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    _doc(a, [core.metric("good", 1, ""), core.metric("bad", 1, "")])
    _doc(b, [core.metric("good", 1, ""), core.metric("bad", 9, "")])
    assert sc.main(["diff", str(a), str(b), "--quiet"]) == 1
    out = capsys.readouterr().out.splitlines()
    assert out[0].startswith("metric")
    assert len(out) == 3 and out[1].startswith("bad") and out[2] == "summary: regressed=1, same=1"


def test_main_requires_subcommand(capsys):
    with pytest.raises(SystemExit) as e:
        sc.main([])
    assert e.value.code == 2


def test_main_run_requires_root(capsys):
    with pytest.raises(SystemExit) as e:
        sc.main(["run", "--out", "x.json"])
    assert e.value.code == 2
    assert "--root" in capsys.readouterr().err


def test_main_run_requires_out(capsys):
    with pytest.raises(SystemExit) as e:
        sc.main(["run", "--root", str(ROOT)])
    assert e.value.code == 2
    assert "run requires --out" in capsys.readouterr().err


# --- cmd_run in-process with fake probes -----------------------------------


@pytest.fixture
def tree(tmp_path):
    t = tmp_path / "tree"
    (t / "scripts").mkdir(parents=True)
    (t / "hooks").mkdir()
    return t


def _fake_probes(monkeypatch, probes):
    monkeypatch.setattr(sc, "load_probes", lambda: probes)


def _p_ok(ctx):
    return [core.metric("ok.n", 3, "u")]


def _p_bad(ctx):
    raise RuntimeError("kaboom")


def test_run_writes_document(tree, tmp_path, monkeypatch, capsys):
    _fake_probes(
        monkeypatch,
        {"alpha_long_name": (_p_ok, ["ok.n"], "hooks", False), "beta": (_p_bad, ["b.x"], "mesh", False)},
    )
    out = tmp_path / "o" / "r.json"
    rc = sc.main(["run", "--root", str(tree), "--out", str(out), "--work", str(tmp_path / "w"), "--runs", "7"])
    assert rc == 0
    doc = json.loads(out.read_text())
    assert doc["schema"] == core.SCHEMA_VERSION
    assert set(doc["probes"]) == {"alpha_long_name", "beta"}
    assert doc["probes"]["alpha_long_name"]["state"] == "ok" and doc["probes"]["alpha_long_name"]["module"] == "hooks"
    assert doc["probes"]["alpha_long_name"]["metrics"] == 1
    assert doc["probes"]["beta"]["state"] == "error"
    assert doc["probes"]["beta"]["metrics"] == 2
    meta = doc["meta"]
    assert meta["root"] == str(tree.resolve())
    assert meta["quick"] is False and meta["runs"] == 7 and meta["repeat"] == 1
    assert meta["db"] == "synthetic" and meta["only"] is None
    assert meta["metric_count"] == 3
    assert meta["states"] == {"ok": 1, "error": 2}
    assert meta["python"] and meta["platform"]
    assert "started_at" in meta and isinstance(meta["wall_s"], float)
    err = capsys.readouterr().err
    assert "[scorecard] alpha_long_name ..." in err
    assert "[scorecard] alpha_long_name: 1 metrics in" in err
    assert f"[scorecard] wrote {out.resolve()}: 3 metrics" in err
    assert out.read_text().endswith("}\n")


def test_run_states_count(tree, tmp_path, monkeypatch):
    def p(ctx):
        return [
            core.metric("a", 1, "u"),
            core.metric("b", 2, "u"),
            core.skipped("c", "no thing"),
        ]

    _fake_probes(monkeypatch, {"p": (p, [], "misc", False)})
    out = tmp_path / "r.json"
    sc.main(["run", "--root", str(tree), "--out", str(out), "--work", str(tmp_path / "w")])
    doc = json.loads(out.read_text())
    assert doc["meta"]["states"] == {"ok": 2, "skipped": 1}
    assert doc["meta"]["metric_count"] == 3


def test_run_skipped_reasons_printed(tree, tmp_path, monkeypatch, capsys):
    _fake_probes(
        monkeypatch,
        {"p": (lambda c: [core.skipped("needs_x", "x missing")], [], "misc", False)},
    )
    sc.main(["run", "--root", str(tree), "--out", str(tmp_path / "r.json"), "--work", str(tmp_path / "w")])
    assert "[scorecard]   skipped needs_x: x missing" in capsys.readouterr().err


def test_run_quick_skips_slow_probes(tree, tmp_path, monkeypatch, capsys):
    _fake_probes(
        monkeypatch,
        {
            "fast": (_p_ok, ["ok.n"], "hooks", False),
            "slow": (_p_bad, ["slow.a", "slow.b"], "mesh", True),
        },
    )
    out = tmp_path / "r.json"
    sc.main(["run", "--root", str(tree), "--out", str(out), "--quick", "--work", str(tmp_path / "w")])
    doc = json.loads(out.read_text())
    assert doc["probes"]["slow"] == {"module": "mesh", "state": "skipped", "wall_s": 0}
    assert doc["metrics"]["slow.a"]["state"] == "skipped"
    assert doc["metrics"]["slow.a"]["reason"] == "skipped by --quick (slow probe)"
    assert doc["metrics"]["slow.a"]["remeasure"] == "--only slow"
    assert doc["probes"]["fast"]["state"] == "ok"
    assert doc["meta"]["quick"] is True and doc["meta"]["runs"] == 5
    assert "[scorecard] slow: skipped (--quick)" in capsys.readouterr().err


def test_run_budget_per_mode(tree, tmp_path, monkeypatch):
    seen = {}

    def fake_run_probe(name, fn, declared, ctx, repeat, budget=150):
        seen[name] = (repeat, budget)
        return {}, 0.0

    monkeypatch.setattr(sc, "run_probe", fake_run_probe)
    _fake_probes(
        monkeypatch,
        {"n": (_p_ok, [], "hooks", False), "s": (_p_ok, [], "mesh", True)},
    )
    base = ["run", "--root", str(tree), "--work", str(tmp_path / "w"), "--repeat", "3"]
    sc.main(base + ["--out", str(tmp_path / "a.json")])
    assert seen == {"n": (3, 90), "s": (3, 200)}
    seen.clear()
    sc.main(base + ["--out", str(tmp_path / "b.json"), "--quick"])
    assert seen == {"n": (3, 45)}


def test_run_only_filter_by_name_and_module(tree, tmp_path, monkeypatch):
    _fake_probes(
        monkeypatch,
        {
            "a1": (_p_ok, [], "hooks", False),
            "a2": (_p_ok, [], "hooks", False),
            "b1": (_p_ok, [], "mesh", False),
        },
    )
    out = tmp_path / "r.json"
    sc.main(["run", "--root", str(tree), "--out", str(out), "--only", "a1,mesh", "--work", str(tmp_path / "w")])
    doc = json.loads(out.read_text())
    assert set(doc["probes"]) == {"a1", "b1"}
    assert doc["meta"]["only"] == ["a1", "mesh"]


def test_run_unknown_only_rejected(tree, tmp_path, monkeypatch, capsys):
    _fake_probes(monkeypatch, {"a": (_p_ok, [], "hooks", False)})
    out = tmp_path / "r.json"
    rc = sc.main(["run", "--root", str(tree), "--out", str(out), "--only", "zzz"])
    assert rc == 2
    assert "unknown probe(s) ['zzz']" in capsys.readouterr().err
    assert not out.exists()


def test_run_root_without_dirs_rejected(tmp_path, capsys):
    (tmp_path / "scripts").mkdir()
    assert sc.main(["run", "--root", str(tmp_path), "--out", str(tmp_path / "r.json")]) == 2
    assert "has no scripts/ and hooks/" in capsys.readouterr().err


def test_run_list(tree, monkeypatch, capsys):
    _fake_probes(
        monkeypatch,
        {"alpha_long_name": (_p_ok, ["m1", "m2"], "hooks", True), "beta": (_p_ok, ["m3"], "mesh", False)},
    )
    assert sc.main(["run", "--root", str(tree), "--list"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0] == f"{'alpha_long_name':24s} {'hooks':11s} {'slow'} m1,m2"
    assert lines[1] == f"{'beta':24s} {'mesh':11s} {''} m3"


def test_run_merge_keeps_other_probes(tree, tmp_path, monkeypatch):
    out = tmp_path / "r.json"
    _fake_probes(monkeypatch, {"a": (_p_ok, [], "hooks", False), "b": (lambda c: [core.metric("b.n", 9, "u")], [], "mesh", False)})
    w = ["--work", str(tmp_path / "w")]
    sc.main(["run", "--root", str(tree), "--out", str(out)] + w)
    sc.main(["run", "--root", str(tree), "--out", str(out), "--only", "b", "--merge"] + w)
    doc = json.loads(out.read_text())
    assert set(doc["probes"]) == {"a", "b"} and "ok.n" in doc["metrics"]
    assert doc["meta"]["only"] == ["b"]
    # without --merge the old probe is dropped
    sc.main(["run", "--root", str(tree), "--out", str(out), "--only", "b"] + w)
    assert set(json.loads(out.read_text())["probes"]) == {"b"}


def test_run_db_recorded(tree, tmp_path, monkeypatch):
    _fake_probes(monkeypatch, {"a": (_p_ok, [], "hooks", False)})
    db = tmp_path / "copy.db"
    db.write_text("")
    out = tmp_path / "r.json"
    sc.main(["run", "--root", str(tree), "--out", str(out), "--db", str(db), "--work", str(tmp_path / "w")])
    assert json.loads(out.read_text())["meta"]["db"] == str(db)


def test_run_closes_ctx_on_probe_abort(tree, tmp_path, monkeypatch):
    closed = []
    real_close = core.Ctx.close

    def close(self):
        closed.append(1)
        real_close(self)

    monkeypatch.setattr(core.Ctx, "close", close)

    def boom(*a, **k):
        raise KeyboardInterrupt

    monkeypatch.setattr(sc, "run_probe", boom)
    _fake_probes(monkeypatch, {"a": (_p_ok, [], "hooks", False)})
    with pytest.raises(KeyboardInterrupt):
        sc.main(["run", "--root", str(tree), "--out", str(tmp_path / "r.json"), "--work", str(tmp_path / "w")])
    assert closed == [1]
