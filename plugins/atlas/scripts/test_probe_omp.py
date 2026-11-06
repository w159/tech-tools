"""probe_omp: bun suite, typecheck and hook-bridge probes. bun, tsc and the child processes are external,
so `run` and the tool lookups are stubbed; what is tested is output parsing, skip/error decisions,
tsconfig generation and metric math."""

import json
import re
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
from scorecard import core  # noqa: E402
from scorecard import probe_omp as po  # noqa: E402


def byname(ms):
    return {m["name"]: m for m in ms}


def rr(rc=0, out="", err="", ms=2000.0):
    return {"rc": rc, "out": out, "err": err, "ms": ms}


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    root = tmp_path / "plugins" / "atlas"
    (root / "omp").mkdir(parents=True)
    c = core.Ctx(root, quick=True, work=str(tmp_path / "w"), runs=4)
    c.tmux_real = None
    return c


BUN_OK = "x\n (pass) a\n 12 pass\n 3 fail\nRan 15 tests across 2 files. [450.00ms]\n"


# --- bun_env ----------------------------------------------------------------------


def test_bun_env_symlinks_real_bun_dir(ctx, tmp_path):
    (tmp_path / "home" / ".bun").mkdir()
    env, home = po.bun_env(ctx, "b")
    assert env["HOME"] == str(home)
    assert (home / ".bun").is_symlink()
    assert (home / ".bun").resolve() == (tmp_path / "home" / ".bun").resolve()


def test_bun_env_without_real_bun_dir_makes_no_link(ctx):
    env, home = po.bun_env(ctx, "b")
    assert not (home / ".bun").exists()


def test_bun_env_is_idempotent(ctx, tmp_path):
    (tmp_path / "home" / ".bun").mkdir()
    po.bun_env(ctx, "b")
    po.bun_env(ctx, "b")  # second call must not raise on the existing link


# --- probe_bun_suite --------------------------------------------------------------


def test_bun_suite_skipped_when_bun_missing(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: None)
    out = po.probe_bun_suite(ctx)
    assert len(out) == 1
    assert out[0]["name"] == "omp_suite_pass"
    assert out[0]["state"] == "skipped"
    assert out[0]["reason"] == "bun not installed"
    assert out[0]["direction"] == "higher"


def test_bun_suite_parses_counts_and_wall(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    seen = {}

    def fake_run(argv, **kw):
        seen.update(argv=argv, **kw)
        return rr(0, BUN_OK, "(fail) suite > broken test [1.00ms]\n")

    monkeypatch.setattr(po, "run", fake_run)
    m = byname(po.probe_bun_suite(ctx))
    assert m["omp_suite_pass"]["value"] == 12
    assert m["omp_suite_pass"]["direction"] == "higher"
    assert m["omp_suite_fail"]["value"] == 3
    assert m["omp_suite_fail"]["direction"] == "lower"
    assert m["omp_suite_fail"]["detail"] == ["suite > broken test [1.00ms]"]
    assert m["omp_suite_wall_s"]["value"] == 0.45
    assert m["omp_suite_wall_s"]["direction"] == "info"
    assert seen["argv"] == ["/usr/bin/bun", "test"]
    assert seen["cwd"] == str(ctx.root / "omp")
    assert seen["timeout"] == 900
    assert "ATLAS_GATES" not in seen["env"]


def test_bun_suite_uses_real_home_not_the_scratch_one(ctx, monkeypatch, tmp_path):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    seen = {}
    monkeypatch.setattr(po, "run", lambda argv, **kw: seen.update(kw) or rr(0, BUN_OK))
    po.probe_bun_suite(ctx)
    assert seen["env"]["HOME"] == str(tmp_path / "home")


def test_bun_suite_seconds_unit_and_fallback_to_wall_clock(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(0, "1 pass\n0 fail\nRan 1 test across 1 file. [2.50s]\n"))
    assert byname(po.probe_bun_suite(ctx))["omp_suite_wall_s"]["value"] == 2.5
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(0, "1 pass\n0 fail\n", ms=7000.0))
    assert byname(po.probe_bun_suite(ctx))["omp_suite_wall_s"]["value"] == 7.0


@pytest.mark.parametrize("res", [rr("TIMEOUT", BUN_OK), rr(1, "boom"), rr(0, "12 pass\n"), rr(0, "3 fail\n")])
def test_bun_suite_unparseable_or_timeout_is_error_metric(ctx, monkeypatch, res):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    monkeypatch.setattr(po, "run", lambda *a, **k: res)
    out = po.probe_bun_suite(ctx)
    assert len(out) == 1
    assert out[0]["name"] == "omp_suite_pass"
    assert out[0]["state"] == "error"
    assert f"rc={res['rc']}" in out[0]["reason"]
    assert out[0]["group"] == "omp"


def test_bun_suite_reason_keeps_only_output_tail(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(2, "HEAD" + "x" * 500 + "TAIL"))
    reason = po.probe_bun_suite(ctx)[0]["reason"]
    assert "TAIL" in reason and "HEAD" not in reason


# --- probe_typecheck --------------------------------------------------------------


def stage_types(tmp_path, omp=True, bun=True):
    home = tmp_path / "home"
    if omp:
        p = home / ".bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/types/index.d.ts"
        p.parent.mkdir(parents=True)
        p.write_text("")
    if bun:
        for v in ("1.0.0", "1.2.0"):
            q = home / f".bun/install/cache/bun-types/{v}/index.d.ts"
            q.parent.mkdir(parents=True)
            q.write_text("")


def test_typecheck_skip_reasons_in_priority_order(ctx, monkeypatch, tmp_path):
    monkeypatch.setattr(po.shutil, "which", lambda n: None)
    assert po.probe_typecheck(ctx)[0]["reason"] == "tsc missing"
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/tsc")
    assert po.probe_typecheck(ctx)[0]["reason"] == "omp dist types missing"
    stage_types(tmp_path, omp=True, bun=False)
    r = po.probe_typecheck(ctx)[0]
    assert r["reason"] == "bun-types cache missing"
    assert r["state"] == "skipped"
    assert r["name"] == "omp_typecheck_errors"


def test_typecheck_counts_errors_and_writes_tsconfig(ctx, monkeypatch, tmp_path):
    stage_types(tmp_path)
    (ctx.root / "omp" / "a.ts").write_text("")
    (ctx.root / "omp" / "b.ts").write_text("")
    (ctx.root / "omp" / "a.test.ts").write_text("")
    (ctx.root / "omp" / "readme.md").write_text("")
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/tsc")
    seen = {}

    def fake_run(argv, **kw):
        seen.update(argv=argv, **kw)
        return rr(2, "a.ts(1,1): error TS2322: x\nb.ts(2,2): error TS7006: y\n", "c.ts: error TS1005: z")

    monkeypatch.setattr(po, "run", fake_run)
    m = byname(po.probe_typecheck(ctx))
    assert m["omp_typecheck_errors"]["value"] == 3
    assert m["omp_typecheck_errors"]["direction"] == "lower"
    assert "approximation" in m["omp_typecheck_errors"]["note"]
    cfg_path = Path(seen["argv"][-1])
    assert seen["argv"][:2] == ["/usr/bin/tsc", "-p"]
    assert seen["timeout"] == 300
    assert seen["env"]["HOME"] == str(tmp_path / "home")
    cfg = json.loads(cfg_path.read_text())
    assert [Path(f).name for f in cfg["files"]] == ["a.ts", "b.ts"]  # sorted, tests excluded
    co = cfg["compilerOptions"]
    assert co["strict"] is True and co["noEmit"] is True
    bdir = str(tmp_path / "home/.bun/install/cache/bun-types/1.2.0")  # last sorted version
    assert co["paths"]["bun"] == [bdir + "/index.d.ts"]
    assert co["paths"]["bun:test"] == [bdir + "/test.d.ts"]
    assert co["paths"]["bun:sqlite"] == [bdir + "/sqlite.d.ts"]
    assert co["paths"]["@oh-my-pi/pi-coding-agent"][0].endswith("dist/types/index.d.ts")
    assert str(tmp_path / "home/.bun/install/cache/bun-types") in co["typeRoots"]


def test_typecheck_zero_errors_when_clean(ctx, monkeypatch, tmp_path):
    stage_types(tmp_path)
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/tsc")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(0, "", ""))
    assert byname(po.probe_typecheck(ctx))["omp_typecheck_errors"]["value"] == 0


@pytest.mark.parametrize("rc", ["TIMEOUT", "OSERROR"])
def test_typecheck_run_failure_is_error_not_zero(ctx, monkeypatch, tmp_path, rc):
    stage_types(tmp_path)
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/tsc")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(rc, "error TS1 error TS2"))
    out = po.probe_typecheck(ctx)
    assert out[0]["state"] == "error"
    assert out[0]["value"] is None
    assert out[0]["reason"] == f"tsc failed to run: {rc}"


# --- _bridge_run / _fmt / probe_bridge_* --------------------------------------------


def test_fmt_substitutes_bridge_path_cwd_and_extras(ctx):
    src = po._fmt(po.BRIDGE_TS, ctx, "bridge", n=7)
    assert str(ctx.root / "omp/hook-bridge.ts") in src
    assert str(ctx.sub("bridge") / "proj") in src
    assert "const N = 7;" in src
    assert "%(" not in src
    hang = po._fmt(po.HANG_TS, ctx, "bh")
    assert "%(" not in hang


def test_bridge_run_stages_project_and_parses_last_sc_result_line(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    seen = {}

    def fake_run(argv, **kw):
        seen.update(argv=argv, **kw)
        return rr(0, 'noise\nSC_RESULT {"a": [1, 2]}\nSC_RESULT {"a": [9]}\n')

    monkeypatch.setattr(po, "run", fake_run)
    res, r = po._bridge_run(ctx, "bridge", "// ts source", 55)
    assert res == {"a": [1, 2]}  # the first SC_RESULT line is used
    assert r["rc"] == 0
    d = ctx.sub("bridge")
    assert (d / "probe.ts").read_text() == "// ts source"
    assert (d / "proj" / "src" / "app.py").read_text() == "x = 1\n"
    assert seen["argv"] == ["/usr/bin/bun", str(d / "probe.ts")]
    assert seen["cwd"] == str(d / "proj")
    assert seen["timeout"] == 55


def test_bridge_run_without_result_line_returns_none(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(1, "no marker here", "stack"))
    res, r = po._bridge_run(ctx, "bridge", "x", 5)
    assert res is None and r["rc"] == 1


def test_bridge_latency_skipped_without_bun(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: None)
    out = po.probe_bridge_latency(ctx)
    assert [o["state"] for o in out] == ["skipped"]
    assert out[0]["name"] == "bridge_bash_pre_p50_ms"


def test_bridge_latency_no_result_is_error_with_output_tail(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(1, "OUTTAIL", "e" * 400))
    out = po.probe_bridge_latency(ctx)
    assert out[0]["state"] == "error"
    assert "bridge probe produced no result:" in out[0]["reason"]
    assert out[0]["reason"].endswith("OUTTAIL")
    assert len(out[0]["reason"]) < 300


def test_bridge_latency_metrics_and_bash_total(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    data = {
        "bash:pre": [10.0, 20.0, 30.0], "bash:post": [1.0, 2.0, 3.0],
        "read:pre": [5.0, 5.0, 5.0], "read:post": [4.0, 4.0, 4.0],
        "floor:run": [100.0, 110.0, 120.0],
    }
    seen = {}

    def fake_run(argv, **kw):
        seen["src"] = Path(argv[1]).read_text()
        return rr(0, "SC_RESULT " + json.dumps(data) + "\n")

    monkeypatch.setattr(po, "run", fake_run)
    m = byname(po.probe_bridge_latency(ctx))
    assert "const N = 4;" in seen["src"]  # ctx.n flows into the generated script
    assert m["bridge_bash_pre_p50_ms"]["value"] == 20.0
    assert m["bridge_bash_post_p50_ms"]["value"] == 2.0
    assert m["bridge_read_pre_p95_ms"]["value"] == 5.0
    assert m["bridge_floor_p50_ms"]["value"] == 110.0
    assert "bridge_floor_run_p50_ms" not in m
    assert m["bridge_bash_total_p50_ms"]["value"] == 22.0  # pre p50 + post p50
    assert m["bridge_bash_total_p50_ms"]["unit"] == "ms"
    assert all(v["group"] == "omp" for v in m.values())


def test_bridge_hang_skipped_without_bun(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: None)
    out = po.probe_bridge_hang(ctx)
    assert out[0]["name"] == "bridge_hang_bash_ms"
    assert out[0]["state"] == "skipped"


def test_bridge_hang_no_result_is_error(ctx, monkeypatch):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(1, "", "crashed"))
    out = po.probe_bridge_hang(ctx)
    assert out[0]["state"] == "error"
    assert out[0]["reason"].startswith("hang probe produced no result:")


@pytest.mark.parametrize(
    "bash,task3,over",
    [(120.0, 130.0, 0), (30000.0, 30000.0, 0), (30001.0, 100.0, 1), (100.0, 31000.0, 1), (40000.0, 50000.0, 2)],
)
def test_bridge_hang_counts_calls_over_30s(ctx, monkeypatch, bash, task3, over):
    monkeypatch.setattr(po.shutil, "which", lambda n: "/usr/bin/bun")
    monkeypatch.setattr(po, "run", lambda *a, **k: rr(0, "SC_RESULT " + json.dumps({"bash": bash, "task3": task3})))
    m = byname(po.probe_bridge_hang(ctx))
    assert m["bridge_hang_bash_ms"]["value"] == bash
    assert m["bridge_hang_task3_ms"]["value"] == task3
    assert m["bridge_hang_over_30s"]["value"] == over
    assert m["bridge_hang_over_30s"]["direction"] == "lower"


def test_embedded_scripts_reference_the_bridge_api():
    for src in (po.BRIDGE_TS, po.HANG_TS):
        assert "registerHookBridge" in src
        assert "SC_RESULT" in src
    assert set(re.findall(r"%\((\w+)\)", po.BRIDGE_TS)) == {"bridge", "cwd", "n"}
    assert set(re.findall(r"%\((\w+)\)", po.HANG_TS)) == {"bridge", "cwd"}


def test_probes_registry():
    assert [p[0] for p in po.PROBES] == ["bun_suite", "typecheck", "bridge_latency", "bridge_hang"]
    flags = {p[0]: p[3] for p in po.PROBES}
    assert flags == {"bun_suite": True, "typecheck": False, "bridge_latency": False, "bridge_hang": True}
    assert dict((p[0], p[2]) for p in po.PROBES)["bun_suite"] == ["omp_suite_pass", "omp_suite_fail"]
