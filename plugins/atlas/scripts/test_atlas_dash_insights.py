#!/usr/bin/env python3
"""Tests for atlas_dash_insights: temp-SQLite fixture, no network, no real ~/.atlas."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import importlib.util
import shutil
import json
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


atlas_db = _load("atlas_db")
ins = _load("atlas_dash_insights")


class Ctx:
    """The ctx surface from the dashboard contract."""

    def __init__(self, conn=None, query=None, body=None):
        self.query = query or {}
        self._body = body if body is not None else {}
        self.groups = ()
        self._conn = conn

    def json(self):
        return self._body

    def db(self):
        return self._conn

    def project_root(self, param):
        return param


NOW = time.time()
ROOT_A = "/work/alpha"
ROOT_B = "/work/beta"
NOISE_ROOT = "/private/var/folders/zz/scratch-run/T/proj"


class InsightsBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name)
        self.conn = sqlite3.connect(str(home / "atlas.db"))
        self.addCleanup(self.conn.close)
        atlas_db.init(self.conn)  # fixture setup only; never per request
        # isolate every on-disk source the module reads
        for attr, rel in (
            ("PREFS_PATH", "dashboard-prefs.json"),
            ("DASHBOARD_LOG", "dashboard.log"),
            ("HOOKSTATE_DIR", "hookstate"),
            ("NUDGE_STAMP", ".atlas_nudge"),
        ):
            old = getattr(ins, attr)
            setattr(ins, attr, home / rel)
            self.addCleanup(setattr, ins, attr, old)
        (home / "hookstate").mkdir()
        self.home = home
        env = mock.patch.dict("os.environ", {"ATLAS_HOME": str(home)})
        env.start()  # atlas_faults reads <ATLAS_HOME>/hook-faults.jsonl, not the real one
        self.addCleanup(env.stop)
        self._seed()

    def _seed(self):
        c = self.conn
        pa = atlas_db.register_project(c, ROOT_A, "alpha")
        pb = atlas_db.register_project(c, ROOT_B, "beta")
        ra = atlas_db.start_run(c, pa, "sess-a", "build alpha")
        atlas_db.start_run(c, pb, "sess-b", "build beta")
        for sid, pid in (("sess-a", pa), ("sess-b", pb)):
            atlas_db.upsert_session_log(c, sid, started_at=NOW - 3600, project_id=pid)
        # one identical failing Bash call x5 (must collapse), one deny, one ok call
        for i in range(5):
            atlas_db.insert_tool_call(
                c,
                "sess-a",
                {
                    "uuid": f"m{i}",
                    "ts": NOW - 600 - i,
                    "tool_use_id": f"e{i}",
                    "tool_name": "Bash",
                    "kind": "builtin",
                    "target": "Bash",
                    "input_summary": f"npm test run {i}",
                    "input_bytes": 5,
                },
            )
            atlas_db.update_tool_result(c, f"e{i}", 1, 10, text="boom")
        atlas_db.insert_tool_call(
            c,
            "sess-a",
            {
                "uuid": "d1",
                "ts": NOW - 500,
                "tool_use_id": "d1",
                "tool_name": "Grep",
                "kind": "builtin",
                "target": "Grep",
                "input_summary": "grep x",
                "input_bytes": 5,
            },
        )
        atlas_db.update_tool_result(
            c, "d1", 1, 10, text="Atlas enforcement: use ctx_search"
        )
        atlas_db.insert_tool_call(
            c,
            "sess-b",
            {
                "uuid": "ok1",
                "ts": NOW - 400,
                "tool_use_id": "ok1",
                "tool_name": "Read",
                "kind": "builtin",
                "target": "Read",
                "input_summary": "read f",
                "input_bytes": 5,
            },
        )
        atlas_db.update_tool_result(c, "ok1", 0, 10, text="fine")
        # one failing call per remaining class: model misuse x2, environment x3
        # (two distinct causes), tool fault x1 (an atlas script traceback)
        for i, (tool, text) in enumerate(
            [
                ("Edit", "File has not been read yet. Read it first before writing."),
                ("Edit", "File has not been read yet. Read it first before writing."),
                ("Bash", "Exit code 1\nnpm ERR! missing script: test"),
                ("Bash", "Exit code 1\nnpm ERR! missing script: test"),
                ("Read", "ENOENT: no such file or directory, open '/x/y'"),
                (
                    "Bash",
                    'Traceback (most recent call last):\n  File "/r/plugins/atlas/scripts/atlas_x.py", line 1, in m',
                ),
            ]
        ):
            atlas_db.insert_tool_call(
                c,
                "sess-a",
                {
                    "uuid": f"x{i}",
                    "ts": NOW - 450 - i,
                    "tool_use_id": f"x{i}",
                    "tool_name": tool,
                    "kind": "builtin",
                    "target": tool,
                    "input_summary": f"{tool} call {i}",
                    "input_bytes": 5,
                },
            )
            atlas_db.update_tool_result(c, f"x{i}", 1, 10, text=text)
        atlas_db.record_friction(
            c, "sess-a", "gate_block", 1.0, "gate said no", ts=NOW - 300
        )
        atlas_db.log_dispatch(c, ra, "", None, None)  # unclassified dispatch
        atlas_db.log_dispatch(c, ra, "atlas:implementer", None, None)
        atlas_db.upsert_finding(
            c,
            "tool_error_rate_high:x",
            dimension="tool reliability",
            severity="MED",
            title="high error rate on x",
            detail="d",
            evidence_json=json.dumps(
                {"miner": "tool_error_rate_high", "metric_value": 0.4}
            ),
            proposed_action="fix",
            target_path="",
        )
        # log_dispatch now stores DEFAULT_AGENT_TYPE for a blank type; a legacy
        # row recorded before that is blank in the DB
        c.execute(
            "UPDATE dispatches SET agent_type='' WHERE id=(SELECT MIN(id) FROM dispatches)"
        )
        c.execute("UPDATE dispatches SET ts=?", (NOW - 200,))
        c.execute("UPDATE runs SET started_at=?", (NOW - 3000,))
        c.commit()

    def get(self, fn, **q):
        return fn(Ctx(self.conn, q))


class TestHealth(InsightsBase):
    def test_silent_failures_detected_with_sources(self):
        st, body = self.get(ins.route_health)
        self.assertEqual(st, 200)
        by_kind = {s["kind"]: s for s in body["silent_failures"]}
        # five identical failing calls collapse to ONE entry with count 5
        self.assertEqual(by_kind["tool_error_unclassified"]["count"], 5)
        self.assertEqual(
            by_kind["tool_error_unclassified"]["source"], "tool_calls.is_error"
        )
        self.assertEqual(by_kind["tool_error_unclassified"]["project"], ROOT_A)
        # enforcement is policy working as designed: never in silent_failures
        self.assertNotIn("gate_deny", by_kind)
        self.assertNotIn("gate_block", by_kind)
        self.assertEqual(by_kind["dispatch_unclassified"]["count"], 1)
        self.assertEqual(
            {s["kind"] for s in body["silent_failures"]},
            {"tool_error_unclassified", "tool_error", "dispatch_unclassified"},
        )
        self.assertEqual(by_kind["tool_error"]["count"], 1)
        enf = body["enforcement"]
        self.assertEqual(enf["counts"], {"gate_deny": 1, "gate_block": 1})
        self.assertEqual(enf["total"], 2)
        self.assertEqual(
            {(r["kind"], r["rule"]): r["count"] for r in enf["top_rules"]},
            {("gate_deny", "Grep"): 1, ("gate_block", "gate_block"): 1},
        )
        self.assertEqual(enf["projects"], [{"project": ROOT_A, "count": 2}])
        for s in body["silent_failures"]:
            for k in (
                "id",
                "kind",
                "project",
                "count",
                "first",
                "last",
                "sample",
                "hint",
                "source",
            ):
                self.assertIn(k, s)

    def test_subsystems_and_successes(self):
        _, body = self.get(ins.route_health)
        ids = {s["id"] for s in body["subsystems"]}
        self.assertEqual(
            ids,
            {
                "hooks",
                "gate",
                "dispatch",
                "mux",
                "dashboard",
                "db",
                "connectors",
                "memory",
                "nudge",
                "doctor",
                "chronicle",
            },
        )
        gate = next(s for s in body["subsystems"] if s["id"] == "gate")
        self.assertEqual(gate["status"], "ok")  # enforcement is not a failure
        kinds = {s["kind"]: s["count"] for s in body["successes"]}
        self.assertEqual(kinds["tool_calls_ok"], 1)
        self.assertEqual(kinds["dispatches_ok"], 1)

    def test_project_filter_scopes_failures(self):
        _, body = self.get(ins.route_health, project=ROOT_B)
        self.assertEqual(
            [s for s in body["silent_failures"] if s["kind"].startswith("tool_error")],
            [],
        )
        self.assertEqual(body["tool_errors"]["total"], 0)

    def test_tool_errors_by_cause(self):
        _, body = self.get(ins.route_health)
        te = body["tool_errors"]
        self.assertEqual(te["total"], 5)
        self.assertEqual(te["counts"], {"model_misuse": 2, "environment": 3})
        top = {(c["class"], c["tool"]): c for c in te["top_causes"]}
        self.assertEqual(top[("model_misuse", "Edit")]["count"], 2)
        self.assertIn("has not been read", top[("model_misuse", "Edit")]["snippet"])
        self.assertEqual(top[("environment", "Bash")]["count"], 2)
        self.assertIn("Exit code 1", top[("environment", "Bash")]["snippet"])
        self.assertIn("ENOENT", top[("environment", "Read")]["snippet"])

    def test_legacy_unknown_without_snippet_is_not_a_silent_failure(self):
        for i in range(3):
            atlas_db.insert_tool_call(
                self.conn,
                "sess-a",
                {
                    "uuid": f"lg{i}",
                    "ts": NOW - 700 - i,
                    "tool_use_id": f"lg{i}",
                    "tool_name": "Glob",
                    "kind": "builtin",
                    "target": "Glob",
                    "input_summary": f"glob {i}",
                    "input_bytes": 5,
                },
            )
            atlas_db.update_tool_result(self.conn, f"lg{i}", 1, 10, text=None)
        self.conn.commit()
        _, body = self.get(ins.route_health)
        kinds = {s["kind"] for s in body["silent_failures"]}
        self.assertNotIn("tool_error_legacy", kinds)
        by_kind = {s["kind"]: s for s in body["silent_failures"]}
        self.assertEqual(by_kind["tool_error_unclassified"]["count"], 5)
        te = body["tool_errors"]
        self.assertEqual(te["legacy"], 3)
        self.assertEqual(te["total"], 5)
        self.assertIn("not attributable", te["legacy_hint"])

    def test_hook_crash_counts_as_silent_failure(self):
        import atlas_faults

        for _ in range(2):
            atlas_faults.record("pretool", ValueError("boom"), cwd=ROOT_A)
        _, body = self.get(ins.route_health)
        crash = {s["kind"]: s for s in body["silent_failures"]}["hook_crash"]
        self.assertEqual(crash["count"], 2)
        self.assertIn("pretool", crash["sample"])
        self.assertIn("ValueError", crash["sample"])
        hooks = next(s for s in body["subsystems"] if s["id"] == "hooks")
        self.assertEqual(hooks["status"], "warn")

    def test_dashboard_log_errors_and_hook_burst(self):
        (self.home / "dashboard.log").write_text(
            '[atlas-dashboard] "GET /api/health HTTP/1.1" 200 -\n'
            "Traceback (most recent call last):\n"
            "OSError: [Errno 48] Address already in use\n"
        )
        (self.home / "hookstate" / "s1.json").write_text(
            json.dumps(
                {
                    "stop_events": [NOW - 10 * i for i in range(6)],
                    "last_run": {"nudge": NOW},
                }
            )
        )
        _, body = self.get(ins.route_health)
        kinds = {s["kind"]: s for s in body["silent_failures"]}
        self.assertEqual(kinds["dashboard_error"]["count"], 1)
        self.assertIn("Address already in use", kinds["dashboard_error"]["sample"])
        self.assertEqual(kinds["hook_burst_tripped"]["source"], "hookstate.stop_events")
        hooks = next(s for s in body["subsystems"] if s["id"] == "hooks")
        self.assertEqual(hooks["status"], "fail")

    def _hooks_row(self, stop_events=None, last_run=None):
        if stop_events is not None or last_run is not None:
            (self.home / "hookstate" / "s1abcdef123456.json").write_text(
                json.dumps(
                    {"stop_events": stop_events or [], "last_run": last_run or {}}
                )
            )
        _, body = self.get(ins.route_health)
        return next(s for s in body["subsystems"] if s["id"] == "hooks")

    def test_old_breaker_trip_with_newer_hook_run_is_warn_naming_the_trip(self):
        trip = NOW - 3600
        row = self._hooks_row([trip - 10 * i for i in range(6)], {"nudge": NOW - 60})
        self.assertEqual(row["status"], "warn")
        self.assertIn("1 circuit-breaker trips", row["detail"])
        self.assertIn(f"last trip {ins._iso(trip)}", row["detail"])
        self.assertIn("session s1abcdef1234", row["detail"])
        self.assertEqual(row["last_ok"], ins._iso(NOW - 60))

    def test_breaker_trip_newer_than_last_hook_run_is_fail(self):
        row = self._hooks_row([NOW - 10 * i for i in range(6)], {"nudge": NOW - 3600})
        self.assertEqual(row["status"], "fail")
        self.assertIn(f"last trip {ins._iso(NOW)}", row["detail"])

    def test_no_breaker_trip_is_ok(self):
        row = self._hooks_row([NOW - 900, NOW - 800], {"nudge": NOW - 60})
        self.assertEqual(row["status"], "ok")
        self.assertNotIn("last trip", row["detail"])

    def test_hook_fault_keeps_warn_even_with_newer_hook_run(self):
        import atlas_faults

        atlas_faults.record("pretool", ValueError("boom"), cwd=ROOT_A)
        row = self._hooks_row([], {"nudge": NOW + 60})
        self.assertEqual(row["status"], "warn")
        self.assertIn("1 swallowed hook crashes", row["detail"])

    def test_access_log_lines_are_not_failures(self):
        (self.home / "dashboard.log").write_text(
            '[atlas-dashboard] "GET /x HTTP/1.1" 500 -\n'
        )
        _, body = self.get(ins.route_health)
        self.assertNotIn(
            "dashboard_error", {s["kind"] for s in body["silent_failures"]}
        )

    def test_regressed_improvement_of_resolved_finding_is_not_actionable(self):
        fid = atlas_db.upsert_finding(
            self.conn,
            "turn_quality:next_turn_correction:x",
            dimension="reply quality",
            severity="LOW",
            title="t",
            detail="d",
            proposed_action="p",
            target_path="x",
        )
        imp = atlas_db.record_improvement(
            self.conn,
            0,
            "reply quality",
            "0.2",
            "0",
            None,
            finding_id=fid,
            metric="turn_quality",
            baseline_value=0.2,
        )
        atlas_db.set_improvement_remeasure(self.conn, imp, 0.5, "regressed")

        def sources():
            _, body = self.get(ins.route_health)
            return {s["source"] for s in body["silent_failures"]}

        self.assertIn("improvements.verdict=regressed", sources())
        self.conn.execute("UPDATE findings SET status='resolved' WHERE id=?", (fid,))
        self.conn.commit()
        self.assertNotIn("improvements.verdict=regressed", sources())

    def test_user_code_traceback_is_a_cause_not_a_silent_failure(self):
        self.conn.execute(
            "INSERT INTO tool_calls(session_id, tool_use_id, tool_name, kind, target, ts, "
            "is_error, denied, error_snippet) VALUES('s-uc','uc1','eval','builtin','eval',?,1,0,?)",
            (
                NOW - 60,
                'Traceback (most recent call last): File "<cell>", line 1 KeyError',
            ),
        )
        self.conn.commit()
        _, body = self.get(ins.route_health)
        self.assertEqual(body["tool_errors"]["counts"].get("user_code"), 1)

    def test_regression_and_missing_tables_degrade(self):
        self.conn.execute("UPDATE findings SET status='regressed'")
        self.conn.commit()
        _, body = self.get(ins.route_health)
        self.assertIn("doctor_regression", {s["kind"] for s in body["silent_failures"]})
        empty = sqlite3.connect(":memory:")  # no tables at all: must not raise
        st, body = ins.route_health(Ctx(empty))
        self.assertEqual(st, 200)
        self.assertEqual(body["silent_failures"], [])
        db_sub = next(s for s in body["subsystems"] if s["id"] == "db")
        self.assertEqual(db_sub["status"], "fail")


class TestProjectsOverviewActivity(InsightsBase):
    def test_projects_grouped_with_counts(self):
        # the route hides roots that no longer exist on disk; these are fixtures
        with mock.patch.object(ins, "_is_fixture_root", lambda r: False):
            _, body = self.get(ins.route_projects)
        by_root = {p["root"]: p for p in body["projects"]}
        self.assertEqual(set(by_root), {ROOT_A, ROOT_B})
        self.assertEqual(by_root[ROOT_A]["runs_7d"], 1)
        self.assertEqual(
            by_root[ROOT_A]["failures_7d"], 5 + 1 + 1
        )  # err+dispatch; enforcement is NOT a failure
        self.assertEqual(by_root[ROOT_A]["enforcement_7d"], 1 + 1)  # deny+gate_block
        self.assertEqual(by_root[ROOT_B]["enforcement_7d"], 0)
        self.assertEqual(by_root[ROOT_A]["health"], "warn")
        self.assertEqual(by_root[ROOT_A]["tool_errors_7d"], 5)
        self.assertEqual(by_root[ROOT_B]["failures_7d"], 0)
        self.assertEqual(by_root[ROOT_B]["health"], "ok")

    def _write_board(self, root: Path, items: list[dict]) -> None:
        run = root / ".atlas" / ".run"
        run.mkdir(parents=True)
        (run / "todos.json").write_text(
            json.dumps({"version": 1, "items": items}), encoding="utf-8"
        )

    def test_todo_counts_skip_archived_like_the_work_board(self):
        """Projects/Overview counts must agree with the Work board: archived items
        are not counted, in-progress counts as open, a blocked flag counts as blocked."""
        root = Path(self.tmp.name) / "proj"
        self._write_board(
            root,
            [
                {"id": "a", "content": "a", "status": "pending"},
                {"id": "b", "content": "b", "status": "in_progress"},
                {"id": "c", "content": "c", "status": "completed"},
                {"id": "d", "content": "d", "status": "pending", "blocked": True},
                {"id": "e", "content": "e", "status": "completed", "archived": True},
                {"id": "f", "content": "f", "status": "completed", "archived": True},
                {"id": "g", "content": "g", "status": "pending", "archived": True},
            ],
        )
        self.assertEqual(
            ins._todo_counts(str(root)), {"open": 2, "done": 1, "blocked": 1}
        )

    def test_todo_counts_missing_board_is_zero(self):
        self.assertEqual(
            ins._todo_counts(str(Path(self.tmp.name) / "nope")),
            {"open": 0, "done": 0, "blocked": 0},
        )

    def test_projects_route_todos_exclude_archived(self):
        root = Path(self.tmp.name) / "withboard"
        self._write_board(
            root,
            [
                {"id": "a", "content": "a", "status": "completed"},
                {"id": "b", "content": "b", "status": "completed", "archived": True},
                {"id": "c", "content": "c", "status": "pending"},
            ],
        )
        p = atlas_db.register_project(self.conn, str(root), "withboard")
        atlas_db.start_run(self.conn, p, "sess-w", "board")
        # a real temp dir is scratch (/var/folders on macOS), which the route hides
        with (
            mock.patch.object(ins, "_is_noise_root", lambda r: False),
            mock.patch.object(ins, "_is_fixture_root", lambda r: False),
        ):
            _, body = self.get(ins.route_projects)
        row = next(x for x in body["projects"] if x["root"] == str(root))
        self.assertEqual(row["todos"], {"open": 1, "done": 1})

    def test_noise_roots_hidden(self):
        p = atlas_db.register_project(self.conn, NOISE_ROOT, "scratch")
        atlas_db.start_run(self.conn, p, "sess-t", "tmp")
        _, body = self.get(ins.route_projects)
        self.assertNotIn(NOISE_ROOT, {x["root"] for x in body["projects"]})

    def test_overview_shape(self):
        _, body = self.get(ins.route_overview, window="7d")
        kpis = {k["id"]: k for k in body["kpis"]}
        self.assertEqual(kpis["runs"]["value"], 2)
        # unclassified 5 + tool fault 1 + dispatch 1; misuse/env are NOT silent
        self.assertEqual(kpis["silent_failures"]["value"], 5 + 1 + 1)
        self.assertEqual(kpis["tool_errors"]["value"], 5)  # misuse 2 + env 3
        self.assertEqual(
            body["tool_errors"]["counts"], {"model_misuse": 2, "environment": 3}
        )
        self.assertEqual(body["enforcement"]["total"], 2)  # deny + gate_block
        self.assertNotIn(
            "gate",
            " ".join(a["title"] for a in body["attention"]),
        )
        self.assertTrue(body["attention"])
        self.assertEqual(
            len(body["trend"]["labels"]), len(body["trend"]["series"][0]["values"])
        )
        self.assertEqual(len(body["recent_runs"]), 2)

    def test_activity_dedupes_and_groups(self):
        _, body = self.get(ins.route_activity, group="project")
        items = [i for g in body["groups"] for i in g["items"]]
        errs = [i for i in items if i["kind"] == "tool_error_unclassified"]
        self.assertEqual(
            len(errs), 1
        )  # five failures with digit-different titles collapse
        self.assertEqual(errs[0]["count"], 5)
        labels = {g["label"] for g in body["groups"]}
        self.assertIn("alpha", labels)
        _, by_kind = self.get(ins.route_activity, group="kind")
        self.assertIn("tool_error_unclassified", {g["key"] for g in by_kind["groups"]})
        _, filt = self.get(ins.route_activity, group="kind", kind="deny")
        self.assertEqual({g["key"] for g in filt["groups"]}, {"deny"})
        _, q = self.get(ins.route_activity, q="grep")
        self.assertTrue(
            all(
                "grep" in (i["title"] + i["detail"]).lower()
                for g in q["groups"]
                for i in g["items"]
            )
        )

    def test_activity_keeps_duplicates_when_collapse_off(self):
        ins.PREFS_PATH.write_text(json.dumps({"noise": {"collapse_duplicates": False}}))
        _, body = self.get(
            ins.route_activity, group="kind", kind="tool_error_unclassified"
        )
        self.assertEqual(sum(len(g["items"]) for g in body["groups"]), 5)

    def test_activity_failed_rows_carry_class_and_snippet(self):
        _, body = self.get(ins.route_activity, group="kind")
        by_key = {g["key"]: g["items"] for g in body["groups"]}
        self.assertIn("tool_misuse", by_key)
        self.assertIn("tool_env", by_key)
        self.assertIn("tool_error", by_key)
        mis = by_key["tool_misuse"][0]
        self.assertEqual(mis["class"], "model_misuse")
        self.assertIn("has not been read", mis["detail"])
        self.assertEqual(mis["count"], 2)
        self.assertEqual(by_key["tool_error"][0]["class"], "tool_fault")
        self.assertEqual(by_key["tool_error_unclassified"][0]["class"], "unknown")

    def test_activity_rejects_bad_group(self):
        st, body = self.get(ins.route_activity, group="nope")
        self.assertEqual(st, 400)
        self.assertFalse(body["ok"])


class TestImprove(InsightsBase):
    def _ledger(self):
        d = Path(self.tmp.name) / "proj" / ".atlas" / ".run"
        d.mkdir(parents=True)
        (d / "findings.json").write_text(
            json.dumps(
                [
                    {
                        "id": "S1",
                        "category": "correctness",
                        "severity": "high",
                        "title": "t1",
                        "evidence": ["e1"],
                        "status": "verified",
                        "verified_at": "2026-10-01T00:00:00+00:00",
                    },
                    {
                        "id": "S2",
                        "category": "correctness",
                        "severity": "medium",
                        "title": "t2",
                        "evidence": [],
                        "status": "needs-evidence",
                        "verified_at": "2026-10-02T00:00:00+00:00",
                    },
                ]
            )
        )
        return str(Path(self.tmp.name) / "proj")

    def test_improve_merges_doctor_and_ledger(self):
        root = self._ledger()
        _, body = self.get(ins.route_improve, project=root)
        sources = {f["source"] for f in body["findings"]}
        self.assertEqual(sources, {"doctor", "ledger"})
        ledger = {f["id"]: f for f in body["findings"] if f["source"] == "ledger"}
        self.assertEqual(ledger["ledger:S1"]["status"], "fixed")
        self.assertEqual(ledger["ledger:S2"]["status"], "open")
        self.assertEqual(
            [s["id"] for s in body["loop"]["stages"]],
            ["observe", "mine", "propose", "apply", "remeasure"],
        )
        self.assertEqual(len(body["ledger"]), 2)
        self.assertEqual(body["nudges"]["throttle_min"], 15)

    def test_by_rule_counts_across_projects(self):
        _, body = self.get(ins.route_improve)
        rules = {r["rule"]: r for r in body["by_rule"]}
        self.assertEqual(rules["tool_error_rate_high"]["count"], 1)

    def test_set_finding_status_via_db_function(self):
        fid = self.conn.execute("SELECT id FROM findings").fetchone()[0]
        st, body = ins.route_improve_finding(
            Ctx(self.conn, body={"id": f"doctor:{fid}", "status": "accepted"})
        )
        self.assertEqual(st, 200, body)
        self.assertTrue(body["ok"])
        row = self.conn.execute(
            "SELECT status, decided_at FROM findings WHERE id=?", (fid,)
        ).fetchone()
        self.assertEqual(row[0], "accepted")
        self.assertIsNotNone(row[1])
        st, body = ins.route_improve_finding(
            Ctx(self.conn, body={"id": f"doctor:{fid}", "status": "fixed"})
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT status FROM findings WHERE id=?", (fid,)
            ).fetchone()[0],
            "applied",
        )

    def test_set_finding_status_rejects_bad_input(self):
        for payload in (
            {},
            {"id": "doctor:1", "status": "bogus"},
            {"id": "ledger:S1", "status": "open"},
            {"id": "doctor:99999", "status": "open"},
        ):
            st, body = ins.route_improve_finding(Ctx(self.conn, body=payload))
            self.assertIn(st, (400, 404), payload)
            self.assertFalse(body["ok"])
            self.assertTrue(body["why"] and body["do"])

    def test_remeasure_uses_doctor_miner(self):
        fid = self.conn.execute("SELECT id FROM findings").fetchone()[0]
        st, body = ins.route_improve_remeasure(
            Ctx(self.conn, body={"id": f"doctor:{fid}"})
        )
        self.assertIn(st, (200, 422), body)
        if st == 200:
            self.assertIn("current", body["state"])
        st, _ = ins.route_improve_remeasure(Ctx(self.conn, body={"id": "x"}))
        self.assertEqual(st, 400)

    def test_improve_carries_enforcement_adherence(self):
        _, body = self.get(ins.route_improve)
        enf = body["enforcement"]
        self.assertEqual(enf["counts"], {"gate_deny": 1, "gate_block": 1})
        self.assertEqual(enf["total"], 2)
        self.assertTrue(enf["top_rules"])
        _, scoped = self.get(ins.route_improve, project=ROOT_B)
        self.assertEqual(scoped["enforcement"]["total"], 0)


class TestImproveNormalisation(InsightsBase):
    """Defects fixed on the Self-improvement page (ledger rows, statuses,
    Propose stage, severity, nudges, score direction, remeasure persistence)."""

    def _write_ledger(self, entries, name="proj"):
        d = Path(self.tmp.name) / name / ".atlas" / ".run"
        d.mkdir(parents=True)
        (d / "findings.json").write_text(json.dumps(entries))
        return str(Path(self.tmp.name) / name)

    def _ledger_rows(self, root):
        _, body = self.get(ins.route_improve, project=root)
        return [f for f in body["findings"] if f["source"] == "ledger"]

    def test_ledger_rows_get_unique_ids_titles_and_times(self):
        root = self._write_ledger(
            [
                {
                    "claim": "no id, claim only",
                    "status": "verified",
                    "verifiedAt": "2026-10-01T00:00:00Z",
                },
                {
                    "claim": "second without id",
                    "status": "verified",
                    "verified_at": "2026-10-02T00:00:00Z",
                },
                {"id": "dup", "title": "t", "status": "verified", "date": "2026-09-25"},
                {
                    "id": "dup",
                    "title": "t2",
                    "status": "verified",
                    "ts": "2026-09-26T00:00:00-04:00",
                },
                {"task": "task-only row", "verdict": "PASS", "date": "2026-09-25"},
            ]
        )
        rows = self._ledger_rows(root)
        ids = [r["id"] for r in rows]
        self.assertEqual(len(ids), len(set(ids)), ids)
        self.assertNotIn("ledger:None", ids)
        by_title = {r["title"]: r for r in rows}
        self.assertIn("no id, claim only", by_title)  # title falls back to claim
        self.assertEqual(by_title["no id, claim only"]["last"], "2026-10-01T00:00:00Z")
        self.assertEqual(by_title["second without id"]["last"], "2026-10-02T00:00:00Z")
        self.assertEqual(by_title["task-only row"]["last"], "2026-09-25T00:00:00+00:00")
        self.assertTrue(all(r["title"] and r["last"] for r in rows))
        # stable: same file and index give the same id on a second request
        self.assertEqual(ids, [r["id"] for r in self._ledger_rows(root)])

    def test_ledger_row_without_timestamp_uses_file_mtime_and_says_so(self):
        root = self._write_ledger([{"claim": "undated", "status": "verified"}])
        (row,) = self._ledger_rows(root)
        self.assertEqual(row["time_source"], "file")
        self.assertTrue(row["last"])

    def test_ledger_statuses_are_explicit_never_silently_open(self):
        cases = {
            "verified": "fixed",
            "rejected": "dismissed",
            "wontfix": "wontfix",
            "needs-evidence": "open",
            "partial": "partial",
            "partially_verified": "partial",
            "unverified": "unverified",
            "superseded": "superseded",
            "refuted-as-shared-factor": "refuted",
            None: "unverified",
            "something-new": "unverified",
        }
        for raw, want in cases.items():
            self.assertEqual(ins._ledger_status(raw), want, raw)

    def test_ledger_rows_are_not_actionable_doctor_rows_are(self):
        root = self._write_ledger([{"id": "L1", "title": "t", "status": "verified"}])
        _, body = self.get(ins.route_improve, project=root)
        by_src = {f["source"]: f for f in body["findings"]}
        self.assertFalse(by_src["ledger"]["actionable"])
        self.assertEqual(by_src["ledger"]["kind"], "ledger")
        self.assertTrue(by_src["doctor"]["actionable"])
        # and the server agrees: ledger ids are refused
        st, _ = ins.route_improve_finding(
            Ctx(self.conn, body={"id": by_src["ledger"]["id"], "status": "open"})
        )
        self.assertEqual(st, 400)

    def test_wontfix_is_its_own_state_and_survives_reload(self):
        fid = self.conn.execute("SELECT id FROM findings").fetchone()[0]
        st, _ = ins.route_improve_finding(
            Ctx(self.conn, body={"id": f"doctor:{fid}", "status": "wontfix"})
        )
        self.assertEqual(st, 200)
        row = self.conn.execute(
            "SELECT status, decided_at FROM findings WHERE id=?", (fid,)
        ).fetchone()
        self.assertEqual(row[0], "wontfix")
        self.assertIsNotNone(row[1])
        _, body = self.get(ins.route_improve)
        (f,) = [x for x in body["findings"] if x["id"] == f"doctor:{fid}"]
        self.assertEqual(f["status"], "wontfix")
        # dismissing is a different state
        ins.route_improve_finding(
            Ctx(self.conn, body={"id": f"doctor:{fid}", "status": "dismissed"})
        )
        _, body = self.get(ins.route_improve)
        (f,) = [x for x in body["findings"] if x["id"] == f"doctor:{fid}"]
        self.assertEqual(f["status"], "dismissed")

    def test_propose_counts_open_and_accepted_doctor_work_apply_counts_fixed(self):
        def stage(body, sid):
            return next(s for s in body["loop"]["stages"] if s["id"] == sid)

        _, body = self.get(ins.route_improve)
        self.assertEqual(stage(body, "propose")["count"], 1)  # the seeded open one
        fid = self.conn.execute("SELECT id FROM findings").fetchone()[0]
        ins.route_improve_finding(
            Ctx(self.conn, body={"id": f"doctor:{fid}", "status": "accepted"})
        )
        _, body = self.get(ins.route_improve)
        self.assertEqual(stage(body, "propose")["count"], 1)  # accepted, not applied
        self.assertEqual(stage(body, "apply")["count"], 0)
        ins.route_improve_finding(
            Ctx(self.conn, body={"id": f"doctor:{fid}", "status": "fixed"})
        )
        _, body = self.get(ins.route_improve)
        self.assertEqual(stage(body, "propose")["count"], 0)
        self.assertEqual(stage(body, "apply")["count"], 1)

    def test_severity_vocabulary_maps_critical_and_major(self):
        for raw, want in {
            "critical": "fail",
            "major": "fail",
            "HIGH": "fail",
            "MED": "warn",
            "Medium": "warn",
            "low": "info",
            "informational": "info",
            None: "info",
        }.items():
            self.assertEqual(ins._sev(raw), want, raw)

    def test_last_nudge_comes_from_hookstate_not_the_stale_stamp(self):
        (self.home / ".atlas_nudge").write_text(str(NOW - 90 * 86400))
        recent = NOW - 120
        (self.home / "hookstate" / "sess-1.json").write_text(
            json.dumps({"last_run": {"nudge": recent}, "emitted": ["a", "b"]})
        )
        (self.home / "hookstate" / "sess-2.json").write_text(
            json.dumps({"last_run": {"nudge": NOW - 5000}})
        )
        n = ins._nudges()
        self.assertEqual(n["source"], "hookstate")
        self.assertEqual(n["last"], ins._iso(recent))
        self.assertEqual(n["sessions_nudged"], 2)

    def test_stamp_is_only_a_fallback_when_hookstate_has_no_nudge(self):
        (self.home / ".atlas_nudge").write_text(str(NOW - 3600))
        n = ins._nudges()
        self.assertEqual(n["source"], "stamp")
        self.assertEqual(n["last"], ins._iso(NOW - 3600))

    def test_score_series_are_normalised_with_a_good_direction(self):
        c = self.conn
        for i, (j, vals) in enumerate(
            {
                "reply_chars": (3000.0, 9000.0),
                "literal_ask_delivered": (0.3, 0.7),
                "scope_drift": (0.6, 0.2),
            }.items()
        ):
            for d, v in enumerate(vals):
                c.execute(
                    "INSERT INTO turn_scores(session_id,message_uuid,ts,judgment,kind,value) "
                    "VALUES(?,?,?,?,?,?)",
                    (
                        "sess-a",
                        f"u{i}{d}",
                        NOW - (len(vals) - d) * 86400,
                        j,
                        "metric",
                        v,
                    ),
                )
        c.commit()
        _, body = self.get(ins.route_improve)
        series = {s["name"]: s for s in body["scores"]["series"]}
        for s in series.values():
            self.assertTrue(all(v is None or 0.0 <= v <= 1.0 for v in s["norm"]), s)
        self.assertEqual(series["literal_ask_delivered"]["direction"], "up")
        self.assertEqual(series["literal_ask_delivered"]["trend"], "improved")
        self.assertEqual(series["reply_chars"]["direction"], "down")
        self.assertEqual(series["reply_chars"]["trend"], "regressed")  # grew
        self.assertEqual(series["scope_drift"]["trend"], "improved")  # fell

    def test_improvement_verdicts_and_asset_verdicts_are_reported(self):
        c = self.conn
        fid = c.execute("SELECT id FROM findings").fetchone()[0]
        run = c.execute("SELECT MIN(id) FROM runs").fetchone()[0]
        iid = atlas_db.record_improvement(
            c, run, "d", "1", "0", "n", finding_id=fid, metric="m", baseline_value=1.0
        )
        atlas_db.set_improvement_remeasure(c, iid, 0.0, "improved")
        pid = c.execute(
            "SELECT id FROM projects WHERE root_path=?", (ROOT_A,)
        ).fetchone()[0]
        atlas_db.record_asset_verdicts(
            c,
            pid,
            [
                {"kind": "skill", "key": "s1", "verdict": "disable-here"},
                {"kind": "agent", "key": "a1", "verdict": "relocate-global"},
            ],
        )
        atlas_db.mark_asset_applied(c, "skill", "s1")
        atlas_db.note_asset_restore(c, "agent", "a1")
        _, body = self.get(ins.route_improve)
        self.assertEqual(body["improvements"]["verdicts"]["improved"], 1)
        (item,) = body["improvements"]["items"]
        self.assertEqual(
            (item["baseline"], item["current"], item["trend"]), (1.0, 0.0, "improved")
        )
        (doctor,) = [f for f in body["findings"] if f["source"] == "doctor"]
        self.assertEqual(
            (doctor["baseline"], doctor["current"], doctor["verdict"]),
            (1.0, 0.0, "improved"),
        )
        av = body["asset_verdicts"]
        self.assertEqual(av["total"], 2)
        self.assertEqual({k["kind"] for k in av["by_kind"]}, {"skill", "agent"})
        self.assertEqual((av["applied"], av["restored"]), (1, 1))

    def test_remeasure_writes_an_improvements_row_and_fills_baseline(self):
        fid = self.conn.execute("SELECT id FROM findings").fetchone()[0]
        orig = ins.atlas_doctor.measure_finding_metric
        ins.atlas_doctor.measure_finding_metric = lambda *a, **k: 0.1
        self.addCleanup(setattr, ins.atlas_doctor, "measure_finding_metric", orig)
        st, body = ins.route_improve_remeasure(
            Ctx(self.conn, body={"id": f"doctor:{fid}"})
        )
        self.assertEqual(st, 200, body)
        self.assertEqual(body["state"]["baseline"], 0.4)  # the miner's recorded value
        self.assertEqual(body["state"]["verdict"], "improved")
        row = self.conn.execute(
            "SELECT baseline_value, remeasured_value, verdict FROM improvements WHERE finding_id=?",
            (fid,),
        ).fetchall()
        self.assertEqual(row, [(0.4, 0.1, "improved")])
        # a second remeasure updates that row instead of piling up new ones
        ins.atlas_doctor.measure_finding_metric = lambda *a, **k: 0.9
        ins.route_improve_remeasure(Ctx(self.conn, body={"id": f"doctor:{fid}"}))
        row = self.conn.execute(
            "SELECT remeasured_value, verdict FROM improvements WHERE finding_id=?",
            (fid,),
        ).fetchall()
        self.assertEqual(row, [(0.9, "regressed")])
        _, page = self.get(ins.route_improve)
        (doctor,) = [f for f in page["findings"] if f["source"] == "doctor"]
        self.assertEqual((doctor["baseline"], doctor["current"]), (0.4, 0.9))

    def test_remeasure_refuses_to_compare_across_metric_units(self):
        fid = self.conn.execute("SELECT id FROM findings").fetchone()[0]
        self.conn.execute(
            "UPDATE findings SET fingerprint='recurring_friction:gate_block' WHERE id=?",
            (fid,),
        )
        old = atlas_db.record_improvement(
            self.conn,
            1,
            "d",
            "4",
            "",
            "recorded by dashboard remeasure",  # no unit marker: legacy raw
            finding_id=fid,
            metric="recurring_friction",
            baseline_value=4.0,
        )
        orig = ins.atlas_doctor.measure_finding_metric
        ins.atlas_doctor.measure_finding_metric = lambda *a, **k: 56.8
        self.addCleanup(setattr, ins.atlas_doctor, "measure_finding_metric", orig)
        st, body = ins.route_improve_remeasure(
            Ctx(self.conn, body={"id": f"doctor:{fid}"})
        )
        self.assertEqual(st, 200, body)
        self.assertEqual(body["state"]["verdict"], "superseded")
        rows = self.conn.execute(
            "SELECT id, baseline_value, verdict, note FROM improvements "
            "WHERE finding_id=? ORDER BY id",
            (fid,),
        ).fetchall()
        self.assertEqual(rows[0][0], old)
        self.assertEqual(rows[0][2], "superseded")  # pending: retired, not judged
        self.assertEqual((rows[1][1], rows[1][2]), (56.8, None))
        self.assertIn("unit=per100_sessions", rows[1][3])
        # a second remeasure now compares like with like
        st, body = ins.route_improve_remeasure(
            Ctx(self.conn, body={"id": f"doctor:{fid}"})
        )
        self.assertEqual(body["state"]["verdict"], "no_change")

    def test_doctor_finding_project_is_resolved_from_evidence_name(self):
        fid = self.conn.execute("SELECT id FROM findings").fetchone()[0]
        self.conn.execute(
            "UPDATE findings SET evidence_json=? WHERE id=?",
            (
                json.dumps(
                    {
                        "miner": "tool_error_rate_high",
                        "metric_value": 0.4,
                        "project": "alpha",
                    }
                ),
                fid,
            ),
        )
        self.conn.commit()
        _, body = self.get(ins.route_improve)
        (f,) = [x for x in body["findings"] if x["source"] == "doctor"]
        self.assertEqual(f["project"], ROOT_A)
        # scoped to the other project the finding is not shown
        _, scoped = self.get(ins.route_improve, project=ROOT_B)
        self.assertFalse([x for x in scoped["findings"] if x["source"] == "doctor"])
        # an unknown project name stays unattributed and visible everywhere
        self.conn.execute(
            "UPDATE findings SET evidence_json=? WHERE id=?",
            (json.dumps({"miner": "tool_error_rate_high", "project": "nowhere"}), fid),
        )
        self.conn.commit()
        _, scoped = self.get(ins.route_improve, project=ROOT_B)
        (f,) = [x for x in scoped["findings"] if x["source"] == "doctor"]
        self.assertEqual(f["project"], "")

    def test_lessons_follow_the_project_filter_and_skip_agent_worktrees(self):
        def lesson(root, name):
            d = Path(root) / "docs" / "lessons"
            d.mkdir(parents=True)
            (d / f"{name}.md").write_text(f"# {name}\n")

        a = Path(self.tmp.name) / "pa"
        b = Path(self.tmp.name) / "pb"
        wt = Path(self.tmp.name) / "pa" / ".claude" / "worktrees" / "agent-x"
        lesson(a, "alpha-lesson")
        lesson(b, "beta-lesson")
        lesson(wt, "alpha-lesson-copy")
        roots = [str(a), str(b), str(wt)]
        scoped = ins._lessons(str(a), roots)
        self.assertEqual([x["title"] for x in scoped], ["alpha-lesson"])
        self.assertEqual(scoped[0]["project_name"], "pa")
        every = {x["title"] for x in ins._lessons(None, roots)}
        self.assertEqual(every, {"alpha-lesson", "beta-lesson"})


class TestPrefs(InsightsBase):
    def test_defaults_when_missing(self):
        _, prefs = ins.route_prefs_get(Ctx())
        self.assertEqual(prefs["theme"], "dark")
        self.assertEqual(
            prefs["noise"], {"collapse_duplicates": True, "min_severity": "info"}
        )

    def test_put_merges_persists_and_roundtrips(self):
        st, body = ins.route_prefs_put(
            Ctx(body={"theme": "light", "pinned_projects": [ROOT_A, ROOT_A]})
        )
        self.assertEqual(st, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["state"]["pinned_projects"], [ROOT_A])  # de-duplicated
        self.assertEqual(body["state"]["density"], "comfortable")  # untouched key kept
        on_disk = json.loads(ins.PREFS_PATH.read_text())
        self.assertEqual(on_disk["theme"], "light")
        ins.route_prefs_put(Ctx(body={"noise": {"min_severity": "warn"}}))
        _, prefs = ins.route_prefs_get(Ctx())
        self.assertEqual(prefs["theme"], "light")
        self.assertEqual(
            prefs["noise"], {"collapse_duplicates": True, "min_severity": "warn"}
        )

    def test_validation_rejects_bad_keys_and_values(self):
        bad = [
            {"nope": 1},
            {"theme": "neon"},
            {"density": 3},
            {"default_project": "relative/path"},
            {"pinned_projects": "x"},
            {"pinned_projects": [1]},
            {"refresh_seconds": 0},
            {"refresh_seconds": True},
            {"refresh_seconds": "8"},
            {"noise": {"x": 1}},
            {"noise": {"min_severity": "loud"}},
            {"noise": {"collapse_duplicates": "yes"}},
            {"saved_views": [{"id": "a", "name": "", "page": "health", "params": {}}]},
            {
                "saved_views": [
                    {"id": "a", "name": "n", "page": "Bad Page!", "params": {}}
                ]
            },
            {"saved_views": "x"},
        ]
        for payload in bad:
            st, body = ins.route_prefs_put(Ctx(body=payload))
            self.assertEqual(st, 400, payload)
            self.assertFalse(body["ok"], payload)
        self.assertFalse(
            ins.PREFS_PATH.exists()
        )  # nothing persisted by rejected updates

    def test_empty_body_rejected_and_good_saved_view(self):
        self.assertEqual(ins.route_prefs_put(Ctx(body={}))[0], 400)
        view = {
            "id": "v1",
            "name": "Failures",
            "page": "health",
            "params": {"project": ROOT_A},
        }
        st, body = ins.route_prefs_put(
            Ctx(body={"saved_views": [view], "default_project": ROOT_A})
        )
        self.assertEqual(st, 200)
        self.assertEqual(body["state"]["saved_views"], [view])

    def test_corrupt_prefs_file_falls_back_to_defaults(self):
        ins.PREFS_PATH.write_text("{not json")
        _, prefs = ins.route_prefs_get(Ctx())
        self.assertEqual(prefs["theme"], "dark")
        ins.PREFS_PATH.write_text(json.dumps({"theme": "neon"}))
        self.assertEqual(ins.route_prefs_get(Ctx())[1]["theme"], "dark")


class TestRoutes(unittest.TestCase):
    def test_route_table(self):
        import re

        got = {(m, p) for m, p, _ in ins.ROUTES}
        self.assertEqual(
            got,
            {
                ("GET", "^/api/v2/projects$"),
                ("GET", "^/api/v2/overview$"),
                ("GET", "^/api/v2/health$"),
                ("GET", "^/api/v2/activity$"),
                ("GET", "^/api/v2/improve$"),
                ("POST", "^/api/v2/improve/finding$"),
                ("POST", "^/api/v2/improve/remeasure$"),
                ("POST", "^/api/v2/improve/selffix$"),
                ("GET", "^/api/v2/prefs$"),
                ("PUT", "^/api/v2/prefs$"),
            },
        )
        for _, pat, fn in ins.ROUTES:
            re.compile(pat)
            self.assertTrue(callable(fn))

    def test_window_parser(self):
        self.assertEqual(ins._window_seconds("7d"), 7 * 86400)
        self.assertEqual(ins._window_seconds("24h"), 86400)
        self.assertEqual(ins._window_seconds("garbage"), 7 * 86400)


class TestHealthHonesty(InsightsBase):
    """Health says what it measured: real last_ok, measured:false + reason, history buckets."""

    def subs(self, conn=None, **q):
        with mock.patch.object(
            ins, "CONNECTOR_STATUS_PROVIDER", None
        ):  # dashboard import sets a real one
            _, body = ins.route_health(Ctx(conn or self.conn, q))
        return {s["id"]: s for s in body["subsystems"]}, body

    def test_empty_home_is_not_measured_with_a_reason_never_a_fake_ok(self):
        empty = sqlite3.connect(":memory:")
        atlas_db.init(empty)  # tables exist, no rows
        shutil.rmtree(self.home / "hookstate")
        subs, body = self.subs(empty)
        want = {
            "hooks": "No hook state recorded yet. Hooks write it after the first session.",
            "gate": "No tool calls recorded yet. Gates are measured from tool_calls.",
            "dispatch": "No dispatches recorded in the database.",
            "mux": "No colony worker runs recorded yet.",
            "memory": "No MEMORY.md in the state directory.",
            "nudge": "The nudge hook has not run yet.",
            "doctor": "The doctor has not recorded any finding yet.",
            "chronicle": "No transcript ingest has run yet.",
            "connectors": "Connector status is not available from this process.",
        }
        for sid, reason in want.items():
            s = subs[sid]
            self.assertFalse(s["measured"], sid)
            self.assertEqual(s["reason"], reason, sid)
            self.assertEqual(s["status"], "unknown", sid)
            self.assertEqual(s["detail"], reason, sid)
            self.assertIsNone(s["last_ok"], sid)
            self.assertIsNone(s["history"], sid)
        for sid in ("db", "dashboard"):  # these ran live: checked now, never "never"
            self.assertTrue(subs[sid]["measured"], sid)
            self.assertIsNotNone(subs[sid]["last_ok"], sid)
            self.assertIsNone(subs[sid]["reason"], sid)
        self.assertEqual(subs["dashboard"]["last_ok"], body["checked_at"])
        for s in subs.values():  # the contract: measured is explicit on every row
            self.assertIn(s["measured"], (True, False))
            if s["measured"]:
                self.assertNotEqual(s["status"], "unknown", s["id"])

    def test_measured_subsystems_carry_real_last_ok_and_last_fail(self):
        c = self.conn
        pid = atlas_db.register_project(c, ROOT_A, "alpha")
        c.execute(
            "INSERT INTO runs(project_id, session_id, started_at, ended_at, task_summary, kind) "
            "VALUES (?, 'w1', ?, ?, 'worker run', 'worker')",
            (pid, NOW - 5000, NOW - 4000),
        )
        c.execute(
            "INSERT INTO ingest_files(session_id, path, cursor_bytes, size, row_keys, updated_at) "
            "VALUES ('s', '/t/s.jsonl', 10, 10, '', ?)",
            (NOW - 100,),
        )
        c.commit()
        (self.home / "memory").mkdir()
        (self.home / "memory" / "MEMORY.md").write_text("m")
        (self.home / ".atlas_nudge").write_text(str(NOW - 50))
        (self.home / "hookstate" / "s1.json").write_text(
            json.dumps(
                {"stop_events": [NOW - 900, NOW - 800], "last_run": {"nudge": NOW - 60}}
            )
        )
        subs, body = self.subs()
        for sid in (
            "hooks",
            "gate",
            "dispatch",
            "mux",
            "db",
            "memory",
            "nudge",
            "doctor",
            "chronicle",
        ):
            self.assertTrue(subs[sid]["measured"], sid)
            self.assertIsNotNone(subs[sid]["last_ok"], sid)
        newest_ok_call = c.execute(
            "SELECT MAX(ts) FROM tool_calls WHERE COALESCE(denied,0)=0"
        ).fetchone()[0]
        self.assertEqual(subs["gate"]["last_ok"], ins._iso(newest_ok_call))
        self.assertEqual(subs["mux"]["last_ok"], ins._iso(NOW - 4000))
        self.assertEqual(subs["chronicle"]["last_ok"], ins._iso(NOW - 100))
        self.assertEqual(subs["hooks"]["last_ok"], ins._iso(NOW - 60))
        self.assertEqual(subs["nudge"]["last_ok"], ins._iso(NOW - 50))
        dispatch_fail = [
            s["last"]
            for s in body["silent_failures"]
            if s["kind"] == "dispatch_unclassified"
        ]
        self.assertEqual(subs["dispatch"]["last_fail"], dispatch_fail[0])
        self.assertIn("open findings", subs["doctor"]["detail"])
        self.assertEqual(subs["dispatch"]["status"], "warn")
        self.assertIn("unclassified of 2 dispatches", subs["dispatch"]["detail"])

    def test_history_is_ten_aligned_buckets_that_add_up(self):
        (self.home / "hookstate" / "s1.json").write_text(
            json.dumps(
                {"stop_events": [NOW - 900, NOW - 800, NOW - 10], "last_run": {}}
            )
        )
        subs, _ = self.subs(window="24h")
        for sid in ("hooks", "gate", "dispatch", "db", "doctor"):
            hist = subs[sid]["history"]
            self.assertEqual(len(hist), ins.HISTORY_BUCKETS, sid)
            stamps = [b["t"] for b in hist]
            self.assertEqual(stamps, sorted(stamps), sid)
            self.assertTrue(subs[sid]["history_source"], sid)
        self.assertEqual(sum(b["ok"] for b in subs["hooks"]["history"]), 3)
        total_calls = self.conn.execute("SELECT COUNT(*) FROM tool_calls").fetchone()[0]
        gate = subs["gate"]["history"]
        self.assertEqual(sum(b["ok"] + b["fail"] for b in gate), total_calls)
        disp = subs["dispatch"]["history"]
        self.assertEqual(
            (sum(b["ok"] for b in disp), sum(b["fail"] for b in disp)), (1, 1)
        )
        self.assertIsNone(subs["dashboard"]["history"])
        self.assertTrue(subs["dashboard"]["history_reason"])

    def test_unsourced_history_says_why(self):
        (self.home / "memory").mkdir()
        (self.home / "memory" / "MEMORY.md").write_text("m")
        (self.home / ".atlas_nudge").write_text(str(NOW - 50))
        subs, _ = self.subs()
        for sid in ("memory", "nudge"):
            self.assertIsNone(subs[sid]["history"])
            self.assertTrue(subs[sid]["history_reason"])

    def test_overview_kpis_carry_aligned_series(self):
        _, body = ins.route_overview(Ctx(self.conn, {"window": "7d"}))
        n = len(body["trend"]["labels"])
        by_id = {k["id"]: k for k in body["kpis"]}
        for kid in (
            "runs",
            "dispatches",
            "silent_failures",
            "tool_errors",
            "findings_open",
        ):
            self.assertEqual(len(by_id[kid]["series"]), n, kid)
            self.assertTrue(by_id[kid]["series_kind"], kid)
        self.assertEqual(sum(by_id["runs"]["series"]), by_id["runs"]["value"])
        self.assertEqual(
            sum(by_id["dispatches"]["series"]), by_id["dispatches"]["value"]
        )
        self.assertEqual(
            sum(by_id["tool_errors"]["series"]), by_id["tool_errors"]["value"]
        )
        self.assertEqual(by_id["runs"]["series"], body["trend"]["series"][0]["values"])
        _, scoped = ins.route_overview(Ctx(self.conn, {"project": ROOT_A}))
        blocked = {k["id"]: k for k in scoped["kpis"]}["todos_blocked"]
        self.assertIsNone(
            blocked["series"]
        )  # the board keeps no history of blocked counts

    def test_findings_counts_name_their_scope(self):
        """Needs-attention (and the top-bar pill, which renders the same list) counts
        grouped failures; the KPI counts open doctor-ledger rows. Different scopes,
        so the KPI must say 'Doctor findings' and attention items must not."""
        _, body = ins.route_overview(Ctx(self.conn, {"window": "7d"}))
        kpi = {k["id"]: k for k in body["kpis"]}["findings_open"]
        open_rows = self.conn.execute(
            "SELECT COUNT(*) FROM findings WHERE status='open'"
        ).fetchone()[0]
        self.assertEqual(kpi["value"], open_rows)
        self.assertEqual(kpi["label"], "Doctor findings")
        self.assertIn("not the Needs-attention list", kpi["hint"])
        for a in body["attention"]:
            self.assertNotIn("doctor", a["title"].lower())
        self.assertTrue(
            all(a["severity"] in ("fail", "warn") for a in body["attention"])
        )


class TestDashboardLogWindow(unittest.TestCase):
    def test_only_lines_after_daemon_start_and_no_404s(self):
        import atlas_dash_insights as ins

        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / "dashboard.log"
            log.write_text("ValueError: old boot failure\n")
            start = log.stat().st_size
            with open(log, "a") as f:
                f.write(
                    "HTTPError: 404 not found /static/retired.js\nKeyError: fresh\n"
                )
            with (
                mock.patch.object(ins, "DASHBOARD_LOG", log),
                mock.patch.object(ins, "_LOG_START", start),
            ):
                out = ins._fold_dashboard_log(time.time() - 60)
            blob = json.dumps(out)
            self.assertIn("KeyError", blob)
            self.assertNotIn("old boot", blob)
            self.assertNotIn("404 not found", blob)
            self.assertNotIn("retired.js", blob)
            with open(log, "a") as f:
                f.write("RuntimeError: upstream returned 404 for tenant\n")
            with (
                mock.patch.object(ins, "DASHBOARD_LOG", log),
                mock.patch.object(ins, "_LOG_START", start),
            ):
                out = ins._fold_dashboard_log(time.time() - 60)
            self.assertEqual(
                out[0]["count"], 2
            )  # KeyError + the real 404-mentioning error


class TestOperatorTruth(InsightsBase):
    """Every fact says what it means, whether it is happening now, and what to do."""

    def health(self):
        with mock.patch.object(ins, "CONNECTOR_STATUS_PROVIDER", None):
            return ins.route_health(Ctx(self.conn, {}))[1]

    def test_active_failure_is_explained_and_dated(self):
        by = {s["kind"]: s for s in self.health()["silent_failures"]}
        d = by["dispatch_unclassified"]  # seeded 200s ago
        self.assertEqual(d["state"], "active")
        self.assertTrue(d["title"] and d["what"] and d["next"])
        self.assertIsNotNone(d["ages_out"])
        body = self.health()
        subs = {s["id"]: s for s in body["subsystems"]}
        self.assertEqual(subs["dispatch"]["status"], "warn")
        for s in subs.values():  # every card says what it measures and what to do
            self.assertTrue(s["what"] and s["next"] and s["warn_means"], s["id"])

    def test_old_failure_is_historic_and_does_not_warn(self):
        self.conn.execute("UPDATE dispatches SET ts=?", (NOW - 3 * 86400,))
        self.conn.commit()
        body = self.health()
        d = {s["kind"]: s for s in body["silent_failures"]}["dispatch_unclassified"]
        self.assertEqual(d["state"], "historic")
        sub = {s["id"]: s for s in body["subsystems"]}["dispatch"]
        self.assertEqual(sub["status"], "ok")
        self.assertIn("historic", sub["detail"])
        self.assertIn(d["ages_out"], sub["detail"])
        _, ov = self.get(ins.route_overview)
        self.assertNotIn(d["id"], {a["id"] for a in ov["attention"]})
        self.assertGreaterEqual(ov["attention_historic"], 1)

    def test_chronicle_counts_transcripts_the_database_never_saw(self):
        self.conn.execute(
            "INSERT INTO ingest_files(session_id,path,cursor_bytes,size,row_keys,updated_at)"
            " VALUES('sess-a','/x/sess-a.jsonl',5,5,'[]',?)",
            (NOW - 100,),
        )
        self.conn.commit()
        proj = self.home / ".claude" / "p"
        proj.mkdir(parents=True)
        for name in ("sess-a", "never-seen"):
            f = proj / f"{name}.jsonl"
            f.write_text(
                '{"type": "user", "cwd": "/work/alpha"}\n'
            )  # a real session has messages
            import os

            os.utime(f, (NOW - 3 * 3600, NOW - 3 * 3600))
        with mock.patch.object(
            ins, "_TRANSCRIPT_GLOBS", (str(self.home / ".claude" / "*" / "*.jsonl"),)
        ):
            sub = {s["id"]: s for s in self.health()["subsystems"]}["chronicle"]
        self.assertEqual(sub["status"], "warn")
        self.assertIn("1 ended sessions were missed", sub["detail"])

    def test_client_hangups_are_not_dashboard_errors(self):
        log = self.home / "dashboard.log"
        log.write_text("BrokenPipeError: [Errno 32] Broken pipe\n")
        with mock.patch.object(ins, "_LOG_START", 0):
            self.assertEqual(ins._fold_dashboard_log(time.time() - 60), [])

    def test_activity_links_sessions_and_hides_scratch(self):
        t = self.home / "t.jsonl"
        t.write_text("{}")
        self.conn.execute(
            "UPDATE session_logs SET transcript_path=? WHERE session_id='sess-a'",
            (str(t),),
        )
        ps = atlas_db.register_project(self.conn, NOISE_ROOT, "scratch")
        atlas_db.start_run(self.conn, ps, "sess-x", "scratch run")
        self.conn.commit()
        _, body = self.get(ins.route_activity)
        items = [i for g in body["groups"] for i in g["items"]]
        self.assertGreaterEqual(body["scratch_hidden"], 1)
        self.assertFalse(any(i["scratch"] for i in items))
        mine = [i for i in items if i["session"] == "sess-a"]
        self.assertTrue(mine and all(i["transcript"] for i in mine))
        self.assertTrue(
            all(i["transcript"] is False for i in items if i["session"] == "sess-b")
        )
        runs = [i for i in items if i["kind"] == "run"]
        self.assertTrue(all(i["title"].startswith(("build", "Session")) for i in runs))
        self.assertIn("deny", body["kinds"])
        _, body = self.get(ins.route_activity, scratch="1")
        self.assertTrue(any(i["scratch"] for g in body["groups"] for i in g["items"]))

    def test_improve_counts_cover_every_finding_and_stages_explain_themselves(self):
        _, body = self.get(ins.route_improve)
        self.assertEqual(sum(body["counts"].values()), len(body["findings"]))
        self.assertTrue(all(s["hint"] for s in body["loop"]["stages"]))


class TestProjectPicker(unittest.TestCase):
    """The Colony/project picker never offers fixtures, temp roots or roots that are gone."""

    def test_fixture_temp_and_missing_roots_are_excluded(self):
        home = Path.home()
        self.assertFalse(
            ins._is_fixture_root(str(SCRIPTS))
        )  # a live, non-temp checkout stays
        with tempfile.TemporaryDirectory() as tmp:
            self.assertTrue(ins._is_fixture_root(tmp))  # exists, but under the temp dir
        for gone in (str(home / "no-such-project-dir"), "/definitely/not/here"):
            self.assertTrue(
                ins._is_fixture_root(gone), gone
            )  # the colony API refuses a non-directory
        for fixture in (str(home / "atlas-e2e-colony2"),):
            self.assertTrue(ins._is_fixture_root(fixture), fixture)


if __name__ == "__main__":
    unittest.main()
