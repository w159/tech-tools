"""probe_misc: doctor, MCP/contract drift and lint probes. The drift probe runs for real against a
fixture tree; the doctor and lint probes shell out to atlas scripts, so `run` (the subprocess boundary)
is stubbed and the metric arithmetic around it is what is tested."""

import json
import sqlite3
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
from scorecard import core  # noqa: E402
from scorecard import probe_misc as pm  # noqa: E402


def byname(ms):
    return {m["name"]: m for m in ms}


def rr(rc=0, out="", err="", ms=1.0):
    return {"rc": rc, "out": out, "err": err, "ms": ms}


@pytest.fixture
def ctx(tmp_path):
    root = tmp_path / "plugins" / "atlas"
    root.mkdir(parents=True)
    c = core.Ctx(root, quick=True, work=str(tmp_path / "w"))
    c.tmux_real = None
    return c


# --- probe_mcp_drift (real filesystem) ---------------------------------------


def make_armada(ctx, servers, userconfig, dirs, env_example=None, contracts=None):
    armada = ctx.root.parent / "armada"
    (armada / ".claude-plugin").mkdir(parents=True)
    (armada / ".mcp.json").write_text(json.dumps({"mcpServers": servers}))
    (armada / ".claude-plugin" / "plugin.json").write_text(json.dumps({"userConfig": {k: {} for k in userconfig}}))
    (armada / "mcp").mkdir()
    for d in dirs:
        (armada / "mcp" / d).mkdir(parents=True)
    if env_example is not None:
        (ctx.root / ".env.example").write_text(env_example)
    for name, text in (contracts or {}).items():
        (ctx.root / "contracts").mkdir(exist_ok=True)
        (ctx.root / "contracts" / name).write_text(text)
    return armada


def test_drift_clean_tree_all_zero(ctx):
    make_armada(
        ctx,
        {"a": {"env": {"CFG_TOKEN": "${user_config.token}"}}, "b": {}},
        ["token"],
        ["a", "b"],
        env_example="# CFG_NOT_REAL=1\nTOKEN=\n",  # TOKEN stands in for CFG_ stripped key
        contracts={"ok.json": "{}"},
    )
    m = byname(pm.probe_mcp_drift(ctx))
    assert m["mcp_servers_wired"]["value"] == 2
    assert m["mcp_servers_wired"]["direction"] == "info"
    for k in ("mcp_servers_vs_dirs_diff", "mcp_userconfig_unused", "mcp_userconfig_undeclared",
              "mcp_env_example_missing", "contracts_unparseable"):
        assert m[k]["value"] == 0, k
        assert m[k]["detail"] == []


def test_drift_reports_each_kind_of_mismatch(ctx):
    make_armada(
        ctx,
        {"a": {"env": {"CFG_ALPHA": "${user_config.used}", "CFG_BETA": "x", "OTHER": "y"}}, "only_cfg": {}},
        ["used", "unused_key"],
        ["a", "only_dir", "_private", ".hidden", "Cache-dir"],
        env_example="# ALPHA=1\n",
        contracts={"bad.json": "{nope", "good.json": "[]"},
    )
    ctx_env = ctx.root / ".env.example"
    assert ctx_env.exists()
    m = byname(pm.probe_mcp_drift(ctx))
    # servers with no dir and dirs with no server; _/./cache dirs are ignored
    assert m["mcp_servers_vs_dirs_diff"]["detail"] == ["only_cfg", "only_dir"]
    assert m["mcp_servers_vs_dirs_diff"]["value"] == 2
    assert m["mcp_userconfig_unused"]["detail"] == ["unused_key"]
    assert m["mcp_userconfig_undeclared"]["value"] == 0
    # CFG_BETA is wired but missing from .env.example; CFG_ALPHA is present (commented form counts)
    assert m["mcp_env_example_missing"]["detail"] == ["BETA"]
    assert m["contracts_unparseable"]["detail"] == ["bad.json"]


def test_drift_undeclared_user_config_refs(ctx):
    make_armada(ctx, {"a": {"args": ["${user_config.ghost}", "${user_config.real}"]}}, ["real"], ["a"])
    m = byname(pm.probe_mcp_drift(ctx))
    assert m["mcp_userconfig_undeclared"]["detail"] == ["ghost"]
    assert m["mcp_userconfig_unused"]["value"] == 0


def test_drift_missing_env_example_means_every_cfg_key_missing(ctx):
    make_armada(ctx, {"a": {"env": {"CFG_X": "1", "CFG_Y": "2"}}}, [], ["a"])
    m = byname(pm.probe_mcp_drift(ctx))
    assert m["mcp_env_example_missing"]["detail"] == ["X", "Y"]


def test_drift_unreadable_manifest_is_a_single_skipped_metric(ctx):
    out = pm.probe_mcp_drift(ctx)  # no armada dir at all
    assert len(out) == 1
    assert out[0]["name"] == "mcp_servers_vs_dirs_diff"
    assert out[0]["state"] == "skipped"
    assert out[0]["value"] is None
    assert "cannot read .mcp.json/plugin.json" in out[0]["reason"]


def test_drift_malformed_json_and_missing_key_also_skip(ctx):
    armada = make_armada(ctx, {}, [], [])
    (armada / ".mcp.json").write_text("{bad")
    assert pm.probe_mcp_drift(ctx)[0]["state"] == "skipped"
    (armada / ".mcp.json").write_text("{}")  # no mcpServers key
    assert pm.probe_mcp_drift(ctx)[0]["state"] == "skipped"


def test_drift_metric_directions_and_group(ctx):
    make_armada(ctx, {}, [], [])
    ms = pm.probe_mcp_drift(ctx)
    assert {m["group"] for m in ms} == {"drift"}
    d = byname(ms)
    assert d["mcp_servers_vs_dirs_diff"]["direction"] == "lower"
    assert d["mcp_servers_wired"]["direction"] == "info"
    assert d["mcp_servers_vs_dirs_diff"]["remeasure"].endswith("mcp_drift")


# --- probe_lint (run stubbed) -------------------------------------------------


def test_lint_counts_violation_lines_and_rc(ctx, monkeypatch):
    calls = []

    def fake_run(argv, **kw):
        calls.append((argv, kw))
        if argv[1].endswith("lint_skill_names.py"):
            return rr(0, "skill-a OK\nskill-b conform\n\n")
        return rr(1, "bad one\nOK fine\n", "worse\n   \nconformant? no\n")

    monkeypatch.setattr(pm, "run", fake_run)
    m = byname(pm.probe_lint(ctx))
    assert m["lint_skill_names_rc"]["value"] == 0
    assert m["lint_skill_names_violation_lines"]["value"] == 0
    assert m["lint_docs_names_rc"]["value"] == 1
    # "bad one" and "worse" violate; "OK fine" and "conformant? no" match \b(OK|conform)
    assert m["lint_docs_names_violation_lines"]["value"] == 2
    assert m["lint_docs_names_violation_lines"]["detail"] == ["bad one", "worse"]
    assert calls[1][0][-1] == "--all"
    assert calls[0][1]["cwd"] == str(ctx.root)
    assert calls[0][1]["timeout"] == 120


def test_lint_rc_is_normalised_to_0_or_1_and_detail_capped(ctx, monkeypatch):
    many = "\n".join(f"v{i}" for i in range(25))
    monkeypatch.setattr(pm, "run", lambda argv, **kw: rr("TIMEOUT", many))
    m = byname(pm.probe_lint(ctx))
    assert m["lint_skill_names_rc"]["value"] == 1
    assert m["lint_skill_names_violation_lines"]["value"] == 25
    assert m["lint_skill_names_violation_lines"]["detail"] == [f"v{i}" for i in range(10)]
    assert {x["group"] for x in m.values()} == {"lint"}


# --- probe_doctor (run + seed stubbed) ------------------------------------------


def fake_seed(ctx_, db, root):
    c = sqlite3.connect(db)
    c.execute("create table metrics (inline_ops, dispatches)")
    c.executemany("insert into metrics values (1, 0)", [()] * 8)
    c.commit()
    c.close()


class DoctorRun:
    def __init__(self, check_rcs=(0,), hook_rc=0, hook_fault=False, mine_out="", iso_out=None):
        self.check_rcs = list(check_rcs)
        self.hook_rc, self.hook_fault, self.mine_out, self.iso_out = hook_rc, hook_fault, mine_out, iso_out
        self.calls = []
        self.state_seen = None

    def __call__(self, argv, **kw):
        self.calls.append((argv, kw))
        env = kw.get("env") or {}
        if "--hook" in argv:
            self.state_seen = (Path(env["ATLAS_DOCTOR_STATE"]).read_text())
            if self.hook_fault:
                with open(Path(env["ATLAS_HOME"]) / "hook-faults.jsonl", "a") as f:
                    f.write('{"f": 1}\n{"f": 2}\n')
            return rr(self.hook_rc)
        if "--mine" in argv:
            return rr(0, self.mine_out)
        if argv[1] == "-c":
            out = self.iso_out if self.iso_out is not None else env["ATLAS_HOME"] + "/atlas.db\n"
            return rr(0, out)
        rc = self.check_rcs[(len([c for c in self.calls if "--hook" not in c[0] and "--mine" not in c[0] and c[0][1] != "-c"]) - 1) % len(self.check_rcs)]
        return rr(rc, ms=10.0)


def test_doctor_happy_path_metrics(ctx, monkeypatch):
    dr = DoctorRun(mine_out='{"a": "ok"}')
    monkeypatch.setattr(pm, "run", dr)
    monkeypatch.setattr(core, "seed_db", fake_seed)
    m = byname(pm.probe_doctor(ctx))
    assert m["doctor_check_p50_ms"]["detail"] == {"n": 3}  # quick mode -> 3 samples
    assert m["doctor_check_crashes"]["value"] == 0
    assert m["doctor_hook_corrupt_state_rc"]["value"] == 0
    assert m["doctor_hook_corrupt_state_traced"]["value"] == 0
    assert m["doctor_miner_errors"]["value"] == 0
    assert m["isolation_db_follows_atlas_home"]["value"] == 1
    assert dr.state_seen == "{not json"
    assert all(x["group"] == "doctor" for x in m.values())


def test_doctor_sample_count_depends_on_quick(ctx, monkeypatch):
    dr = DoctorRun()
    monkeypatch.setattr(pm, "run", dr)
    monkeypatch.setattr(core, "seed_db", fake_seed)
    ctx.quick = False
    m = byname(pm.probe_doctor(ctx))
    assert m["doctor_check_p50_ms"]["detail"] == {"n": 5}


def test_doctor_crash_counting_ignores_0_and_1(ctx, monkeypatch):
    dr = DoctorRun(check_rcs=(0, 1, 2, "TIMEOUT", 139))
    ctx.quick = False
    monkeypatch.setattr(pm, "run", dr)
    monkeypatch.setattr(core, "seed_db", fake_seed)
    m = byname(pm.probe_doctor(ctx))
    assert m["doctor_check_crashes"]["value"] == 3  # 2, TIMEOUT, 139


def test_doctor_hook_failure_and_fault_trace(ctx, monkeypatch):
    dr = DoctorRun(hook_rc=3, hook_fault=True)
    monkeypatch.setattr(pm, "run", dr)
    monkeypatch.setattr(core, "seed_db", fake_seed)
    m = byname(pm.probe_doctor(ctx))
    assert m["doctor_hook_corrupt_state_rc"]["value"] == 1
    assert m["doctor_hook_corrupt_state_traced"]["value"] == 2
    assert m["doctor_hook_corrupt_state_traced"]["direction"] == "higher"
    hook_call = next(c for c in dr.calls if "--hook" in c[0])
    assert json.loads(hook_call[1]["input"]) == {"hook_event_name": "SessionStart"}


def test_doctor_miner_errors_counted_from_output(ctx, monkeypatch):
    dr = DoctorRun(mine_out='{"m1": "error: boom", "m2": "ok", "m3": "error: bad", "note": "an error: not counted"}')
    monkeypatch.setattr(pm, "run", dr)
    monkeypatch.setattr(core, "seed_db", fake_seed)
    m = byname(pm.probe_doctor(ctx))
    assert m["doctor_miner_errors"]["value"] == 2


def test_doctor_nulls_inline_ops_on_five_rows_before_mining(ctx, monkeypatch):
    seen = {}
    base = DoctorRun()

    def spy(argv, **kw):
        if "--mine" in argv:
            c = sqlite3.connect(Path(kw["env"]["ATLAS_HOME"]) / "atlas.db")
            seen["nulls"] = c.execute("select count(*) from metrics where inline_ops is null").fetchone()[0]
            seen["disp"] = c.execute("select count(*) from metrics where dispatches=2").fetchone()[0]
            c.close()
        return base(argv, **kw)

    monkeypatch.setattr(pm, "run", spy)
    monkeypatch.setattr(core, "seed_db", fake_seed)
    pm.probe_doctor(ctx)
    assert seen == {"nulls": 5, "disp": 5}


def test_doctor_db_preparation_failure_is_an_error_metric(ctx, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no db")

    monkeypatch.setattr(pm, "run", DoctorRun())
    monkeypatch.setattr(core, "seed_db", boom)
    m = byname(pm.probe_doctor(ctx))
    miner = m["doctor_miner_errors"]
    assert miner["state"] == "error"
    assert miner["value"] is None
    assert "could not prepare DB: no db" in miner["reason"]


def test_doctor_isolation_flag_false_when_db_resolves_elsewhere(ctx, monkeypatch):
    monkeypatch.setattr(pm, "run", DoctorRun(iso_out="/home/real/.atlas/atlas.db\n"))
    monkeypatch.setattr(core, "seed_db", fake_seed)
    assert byname(pm.probe_doctor(ctx))["isolation_db_follows_atlas_home"]["value"] == 0


def test_doctor_isolation_probe_drops_db_overrides(ctx, monkeypatch):
    dr = DoctorRun()
    monkeypatch.setattr(pm, "run", dr)
    monkeypatch.setattr(core, "seed_db", fake_seed)
    pm.probe_doctor(ctx)
    call = next(c for c in dr.calls if c[0][1] == "-c")
    assert "ATLAS_DB" not in call[1]["env"]
    assert "ATLAS_DASHBOARD_DB" not in call[1]["env"]
    assert "ATLAS_HOME" in call[1]["env"]
    assert str(ctx.scripts) in call[0][2]


def test_probes_registry_names_and_gates():
    names = [p[0] for p in pm.PROBES]
    assert names == ["doctor", "mcp_drift", "lint"]
    for name, fn, gate, flag in pm.PROBES:
        assert callable(fn)
        assert isinstance(gate, list) and gate
        assert flag is False
    assert dict((p[0], p[2]) for p in pm.PROBES)["lint"] == ["lint_skill_names_rc", "lint_docs_names_rc"]
