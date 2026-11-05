"""omp_runstate must leave atlas.db and .atlas/.run in exactly the state the
Claude hooks (session_boot, dispatch_tripwire) would, so completion_gate sees an
omp session the same way it sees a Claude one."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOOKS = os.path.join(HERE, "..", "hooks")
sys.path.insert(0, HERE)
sys.path.insert(0, HOOKS)

import atlas_db  # noqa: E402
import session_boot  # noqa: E402

RUNSTATE = os.path.join(HERE, "omp_runstate.py")


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class RunstateTest(unittest.TestCase):
    SID = "omp-run-1"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.db = os.path.join(self.tmp, "atlas.db")
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.proj, "docs"))
        _git(self.proj, "init", "-q")
        with open(os.path.join(self.proj, "tracked.py"), "w") as fh:
            fh.write("x = 1\n")
        with open(os.path.join(self.proj, "docs", "CHANGELOG.md"), "w") as fh:
            fh.write("# c\n")
        self.env = dict(os.environ, ATLAS_DB=self.db)
        self._old_db = os.environ.get("ATLAS_DB")
        os.environ["ATLAS_DB"] = self.db
        self.addCleanup(self._restore)

    def _restore(self):
        if self._old_db is None:
            os.environ.pop("ATLAS_DB", None)
        else:
            os.environ["ATLAS_DB"] = self._old_db

    def run_cli(self, cmd, *extra, sid=None, cwd=None):
        argv = [
            sys.executable,
            RUNSTATE,
            cmd,
            "--session-id",
            self.SID if sid is None else sid,
            "--cwd",
            cwd or self.proj,
            *extra,
        ]
        proc = subprocess.run(argv, capture_output=True, text=True, env=self.env)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
        self.assertEqual(len(lines), 1, "contract: exactly one JSON line")
        return json.loads(lines[0])

    def query(self, sql, *args):
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute(sql, args).fetchall()
        finally:
            conn.close()

    # ---- begin ---------------------------------------------------------
    def test_begin_is_idempotent(self):
        first = self.run_cli("begin")
        second = self.run_cli("begin")
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["run_id"], second["run_id"])
        self.assertEqual(
            self.query("SELECT COUNT(*) FROM runs WHERE session_id=?", self.SID), [(1,)]
        )

    def test_begin_after_run_finalized_starts_a_new_run_like_session_boot(self):
        """session_boot guards on current_run_id (open runs only), so a resumed
        session whose run was finalized by Stop gets a fresh run. Same here."""
        self.run_cli("begin")
        conn = atlas_db.connect()
        atlas_db.finalize_run(conn, atlas_db.current_run_id(conn, self.SID))
        conn.close()
        again = self.run_cli("begin")
        self.assertTrue(again["created"])
        self.assertEqual(
            self.query("SELECT COUNT(*) FROM runs WHERE session_id=?", self.SID), [(2,)]
        )

    def test_empty_session_id_never_creates_a_phantom_run(self):
        res = self.run_cli("begin", sid="")
        self.assertFalse(res["ok"])
        # Refused before the DB is touched: no file at all, hence no phantom run.
        self.assertFalse(os.path.exists(self.db))

    def test_two_sessions_do_not_share_a_run(self):
        a = self.run_cli("begin", sid="s-a")
        b = self.run_cli("begin", sid="s-b")
        self.assertNotEqual(a["run_id"], b["run_id"])

    # ---- arm -----------------------------------------------------------
    def test_arm_makes_session_orchestrating_for_the_gate(self):
        self.run_cli("begin")
        conn = atlas_db.connect()
        self.assertFalse(atlas_db.is_orchestrating(conn, self.SID))
        conn.close()
        res = self.run_cli("arm")
        self.assertTrue(res["orchestrating"])
        conn = atlas_db.connect()
        self.assertTrue(atlas_db.is_orchestrating(conn, self.SID))
        conn.close()
        # the same advisory sentinel dispatch_tripwire's arming leaves behind
        self.assertTrue(
            os.path.exists(
                os.path.join(self.proj, ".atlas", ".run", "atlas-orchestrate.active")
            )
        )

    def test_arm_without_begin_creates_the_run(self):
        res = self.run_cli("arm")
        self.assertTrue(res["ok"])
        self.assertEqual(
            self.query("SELECT COUNT(*), SUM(orchestrating) FROM runs"), [(1, 1)]
        )

    def test_arm_with_agent_type_and_worktree_records_dispatch_and_flag(self):
        self.run_cli("begin")
        self.run_cli(
            "arm", "--agent-type", "atlas:implementer", "--model", "m-1", "--worktree"
        )
        self.assertEqual(
            self.query("SELECT agent_type, model FROM dispatches"),
            [("atlas:implementer", "m-1")],
        )
        conn = atlas_db.connect()
        self.assertTrue(atlas_db.run_used_worktrees(conn, self.SID))
        conn.close()

    # ---- event ---------------------------------------------------------
    def test_event_logs_inline_ops_with_path_on_main_context(self):
        self.run_cli("begin")
        self.run_cli("event", "--tool", "Edit", "--path", "src/a.py")
        self.run_cli("event", "--tool", "Bash")
        rows = self.query(
            "SELECT tool, context, is_inline_op, path FROM events ORDER BY id"
        )
        self.assertEqual(
            rows, [("Edit", "main", 1, "src/a.py"), ("Bash", "main", 1, None)]
        )
        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, self.SID)
        self.assertEqual(atlas_db.run_changed_paths(conn, rid), ["src/a.py"])
        conn.close()

    def test_event_ignores_untracked_tools_and_missing_run(self):
        self.assertEqual(
            self.run_cli("event", "--tool", "Edit", "--path", "p")["logged"], False
        )  # no run yet
        self.run_cli("begin")
        res = self.run_cli("event", "--tool", "TodoWrite")
        self.assertFalse(res["logged"])
        self.assertEqual(self.query("SELECT COUNT(*) FROM events"), [(0,)])

    def test_task_event_logs_dispatch_even_after_run_finalized(self):
        """dispatch_tripwire resolves dispatches against current-or-last run."""
        self.run_cli("begin")
        conn = atlas_db.connect()
        atlas_db.finalize_run(conn, atlas_db.current_run_id(conn, self.SID))
        conn.close()
        res = self.run_cli("event", "--tool", "Task", "--dispatch", "atlas:verifier")
        self.assertTrue(res["logged"])
        self.assertEqual(
            self.query("SELECT agent_type FROM dispatches"), [("atlas:verifier",)]
        )
        # an inline op needs an OPEN run, so it is not attributed to the closed one
        self.assertFalse(
            self.run_cli("event", "--tool", "Edit", "--path", "x")["logged"]
        )

    # ---- snapshot ------------------------------------------------------
    def test_snapshot_shape_matches_session_boot_exactly(self):
        with open(os.path.join(self.proj, "dirty.py"), "w") as fh:
            fh.write("y = 2\n")
        with open(os.path.join(self.proj, "tracked.py"), "a") as fh:
            fh.write("x = 2\n")
        res = self.run_cli("snapshot")
        self.assertTrue(res["written"])
        with open(res["path"]) as fh:
            got = json.load(fh)

        # What session_boot itself writes for the same tree + a different session.
        twin = session_boot.write_dirty_snapshot(self.proj, "twin-session")
        self.assertIsNotNone(twin)
        with open(str(twin)) as fh:
            want = json.load(fh)
        self.assertEqual(set(got), {"session", "paths"})
        self.assertEqual(got["session"], self.SID)
        self.assertEqual(got["paths"], want["paths"])
        self.assertEqual(set(got["paths"]), {"dirty.py", "tracked.py"})  # docs/ exempt
        self.assertEqual(res["path"], session_boot.snapshot_path(self.proj, self.SID))

    def test_snapshot_is_written_once_per_session(self):
        first = self.run_cli("snapshot")
        with open(os.path.join(self.proj, "late.py"), "w") as fh:
            fh.write("z = 3\n")
        second = self.run_cli("snapshot")
        self.assertTrue(first["written"])
        self.assertFalse(second["written"])
        with open(first["path"]) as fh:
            self.assertNotIn("late.py", json.load(fh)["paths"])

    def test_snapshot_outside_git_is_fail_open(self):
        plain = os.path.join(self.tmp, "plain")
        os.makedirs(os.path.join(plain, "docs"))
        res = self.run_cli("snapshot", cwd=plain)
        self.assertTrue(res["ok"])
        self.assertFalse(res["written"])

    # ---- rebaseline (omp only: MCP servers write tool state after SessionStart) ----
    def _snapshot_paths(self):
        with open(session_boot.snapshot_path(self.proj, self.SID)) as fh:
            return json.load(fh)["paths"]

    def _gate_diff(self):
        """What completion_gate._shell_dirty_edits would count for this session."""
        now = session_boot.dirty_map(self.proj) or {}
        before = self._snapshot_paths()
        return sorted(p for p, h in now.items() if before.get(p) != h)

    def _write(self, rel, text="x\n"):
        path = os.path.join(self.proj, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)

    def test_rebaseline_absorbs_tool_state_written_after_the_snapshot(self):
        self.run_cli("snapshot")
        self._write(".serena/project.yml", "a\n")
        self._write(".serena/.gitignore", "b\n")
        res = self.run_cli("rebaseline")
        self.assertTrue(res["ok"])
        self.assertEqual(
            sorted(res["absorbed"]), [".serena/.gitignore", ".serena/project.yml"]
        )
        # the Stop gate's own comparison now sees no shell edits
        self.assertEqual(self._gate_diff(), [])

    def test_rebaseline_never_absorbs_a_real_code_edit(self):
        self.run_cli("snapshot")
        self._write("src/app.py", "print(1)\n")
        self._write(".serena/project.yml")
        res = self.run_cli("rebaseline")
        self.assertEqual(res["absorbed"], [".serena/project.yml"])
        self.assertNotIn("src/app.py", self._snapshot_paths())
        self.assertEqual(self._gate_diff(), ["src/app.py"])

    def test_rebaseline_is_a_noop_without_a_snapshot_and_keeps_earlier_entries(self):
        self._write(".serena/project.yml")
        self.assertFalse(
            self.run_cli("rebaseline")["absorbed"]
        )  # no snapshot: nothing to rebaseline
        self._write("pre.py")
        self.run_cli("snapshot", sid="s2")
        self.run_cli("rebaseline", sid="s2")
        with open(session_boot.snapshot_path(self.proj, "s2")) as fh:
            self.assertIn(
                "pre.py", json.load(fh)["paths"]
            )  # entries the snapshot already held survive

    def test_rebaseline_absorbs_tool_state_already_in_the_snapshot_whose_content_changed(
        self,
    ):
        # serena rewrites project.yml each session: a file present at SessionStart can differ by Stop
        self._write(".serena/project.yml", "before\n")
        self.run_cli("snapshot")
        self.assertIn(".serena/project.yml", self._snapshot_paths())
        self._write(".serena/project.yml", "after\n")
        self.assertEqual(
            self._gate_diff(), [".serena/project.yml"]
        )  # what the gate would wrongly count
        res = self.run_cli("rebaseline")
        self.assertEqual(res["absorbed"], [".serena/project.yml"])
        self.assertEqual(self._gate_diff(), [])

    def test_rebaseline_never_rewrites_a_changed_code_file_already_in_the_snapshot(
        self,
    ):
        self._write("src/app.py", "v1\n")
        self.run_cli("snapshot")
        self._write(
            "src/app.py", "v2\n"
        )  # the lead edited it through the shell after the snapshot
        self.assertEqual(self.run_cli("rebaseline")["absorbed"], [])
        self.assertEqual(self._gate_diff(), ["src/app.py"])

    def test_rebaseline_resolves_the_docs_root_from_a_subdirectory_cwd(self):
        self.run_cli("snapshot")  # written under the docs root, as session_boot does
        self._write(".serena/project.yml")
        sub = os.path.join(self.proj, "src", "pkg")
        os.makedirs(sub)
        res = self.run_cli("rebaseline", cwd=sub)
        self.assertEqual(res["absorbed"], [".serena/project.yml"])
        self.assertEqual(self._gate_diff(), [])

    # ---- fail-open -----------------------------------------------------
    def test_unwritable_db_and_bad_args_exit_zero_with_ok_false(self):
        blocker = os.path.join(self.tmp, "blocker")
        with open(blocker, "w") as fh:
            fh.write("file, not dir")
        bad_env = dict(self.env, ATLAS_DB=os.path.join(blocker, "atlas.db"))
        proc = subprocess.run(
            [
                sys.executable,
                RUNSTATE,
                "begin",
                "--session-id",
                "s",
                "--cwd",
                self.proj,
            ],
            capture_output=True,
            text=True,
            env=bad_env,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(json.loads(proc.stdout)["ok"])
        proc = subprocess.run(
            [sys.executable, RUNSTATE, "bogus"],
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(json.loads(proc.stdout)["ok"])


import argparse  # noqa: E402
import contextlib  # noqa: E402
import io  # noqa: E402
from unittest import mock  # noqa: E402

import omp_runstate  # noqa: E402


class InProcess(unittest.TestCase):
    """The cmd_* functions called directly, so each return dict is asserted whole."""

    SID = "inproc-1"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        env = mock.patch.dict(os.environ, {"ATLAS_DB": os.path.join(self.tmp, "a.db")})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("ATLAS_WORKER_NAME", None)
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.proj, "docs"))
        _git(self.proj, "init", "-q")

    def ns(self, **kw):
        base = dict(
            session_id=self.SID,
            cwd=self.proj,
            agent_type=None,
            model=None,
            worktree=False,
            tool="Edit",
            path=None,
            dispatch=None,
        )
        base.update(kw)
        return argparse.Namespace(**base)

    def rows(self, sql, *a):
        conn = sqlite3.connect(os.environ["ATLAS_DB"])
        try:
            return conn.execute(sql, a).fetchall()
        finally:
            conn.close()

    # ---- constants ----
    def test_tool_sets_are_the_exact_tripwire_sets(self):
        self.assertEqual(
            omp_runstate.INLINE_TOOLS, {"Read", "Grep", "Glob", "Edit", "Write", "Bash"}
        )
        self.assertEqual(omp_runstate.DISPATCH_TOOLS, {"Agent", "Task"})

    # ---- _tool_state_dirs ----
    def test_tool_state_dirs_reads_the_contract_file(self):
        dirs = omp_runstate._tool_state_dirs()
        self.assertIsInstance(dirs, tuple)
        self.assertIn(".serena", dirs)

    def _fake_here(self, content):
        d = os.path.join(self.tmp, "here", "scripts")
        os.makedirs(d)
        os.makedirs(os.path.join(self.tmp, "here", "contracts"))
        if content is not None:
            with open(
                os.path.join(self.tmp, "here", "contracts", "native-tools.json"), "w"
            ) as fh:
                fh.write(content)
        return mock.patch.object(omp_runstate, "_HERE", d)

    def test_tool_state_dirs_keeps_only_nonempty_strings(self):
        with self._fake_here(
            json.dumps({"ompToolStateDirs": [".a", "", 3, None, ".b"]})
        ):
            self.assertEqual(omp_runstate._tool_state_dirs(), (".a", ".b"))

    def test_tool_state_dirs_unreadable_variants_give_empty_tuple(self):
        for content in (
            None,
            "{bad",
            json.dumps({"other": []}),
            json.dumps({"ompToolStateDirs": 5}),
            json.dumps([1]),
        ):
            with self.subTest(content=content), self._fake_here(content):
                self.assertEqual(omp_runstate._tool_state_dirs(), ())
            shutil.rmtree(os.path.join(self.tmp, "here"))

    # ---- _connect ----
    def test_connect_returns_initialised_db_module_and_connection(self):
        mod, conn = omp_runstate._connect()
        try:
            self.assertIs(mod, atlas_db)
            tables = {
                r[0]
                for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            self.assertTrue({"runs", "events", "dispatches"} <= tables)
        finally:
            conn.close()

    # ---- cmd_begin ----
    def test_begin_returns_run_id_and_created_flag(self):
        res = omp_runstate.cmd_begin(self.ns())
        self.assertEqual(set(res), {"ok", "run_id", "created"})
        self.assertIs(res["ok"], True)
        self.assertIs(res["created"], True)
        self.assertEqual(
            self.rows("SELECT id, session_id FROM runs"), [(res["run_id"], self.SID)]
        )
        again = omp_runstate.cmd_begin(self.ns())
        self.assertEqual(again, {"ok": True, "run_id": res["run_id"], "created": False})

    def test_begin_empty_session_id_exact_error_and_no_db(self):
        res = omp_runstate.cmd_begin(self.ns(session_id=""))
        self.assertEqual(res, {"ok": False, "error": "empty session id"})
        self.assertFalse(os.path.exists(os.environ["ATLAS_DB"]))

    def test_begin_registers_the_project_by_basename(self):
        omp_runstate.cmd_begin(self.ns())
        names = [r[0] for r in self.rows("SELECT name FROM projects")]
        self.assertEqual(names, ["proj"])

    def test_begin_non_project_cwd_is_refused_and_closes_connection(self):
        fake_conn = mock.MagicMock()
        fake_db = mock.MagicMock()
        fake_db.register_project.return_value = None
        with mock.patch.object(
            omp_runstate, "_connect", return_value=(fake_db, fake_conn)
        ):
            res = omp_runstate.cmd_begin(self.ns())
        self.assertEqual(res, {"ok": False, "error": "non-project cwd"})
        fake_conn.close.assert_called_once_with()
        fake_db.start_run.assert_not_called()

    # ---- cmd_arm ----
    def test_arm_empty_session_id_exact_error(self):
        self.assertEqual(
            omp_runstate.cmd_arm(self.ns(session_id="")),
            {"ok": False, "error": "empty session id"},
        )
        self.assertFalse(os.path.exists(os.environ["ATLAS_DB"]))

    def test_arm_for_a_leaf_worker_is_a_noop_without_touching_the_db(self):
        os.environ["ATLAS_WORKER_NAME"] = "implementer-x"
        res = omp_runstate.cmd_arm(self.ns(agent_type="atlas:implementer"))
        self.assertEqual(res, {"ok": True, "run_id": None, "orchestrating": False})
        self.assertFalse(os.path.exists(os.environ["ATLAS_DB"]))

    def test_blank_worker_name_does_not_count_as_a_worker(self):
        os.environ["ATLAS_WORKER_NAME"] = "   "
        res = omp_runstate.cmd_arm(self.ns())
        self.assertIs(res["orchestrating"], True)
        self.assertIsNotNone(res["run_id"])

    def test_arm_marks_orchestrating_and_returns_run_id(self):
        res = omp_runstate.cmd_arm(self.ns())
        self.assertEqual(set(res), {"ok", "run_id", "orchestrating"})
        self.assertIs(res["ok"], True)
        self.assertIs(res["orchestrating"], True)
        self.assertEqual(
            self.rows("SELECT id, orchestrating FROM runs"), [(res["run_id"], 1)]
        )
        self.assertEqual(self.rows("SELECT COUNT(*) FROM dispatches"), [(0,)])

    def test_arm_with_agent_type_logs_exactly_one_dispatch_with_model(self):
        res = omp_runstate.cmd_arm(self.ns(agent_type="atlas:verifier", model="m-9"))
        self.assertEqual(
            self.rows("SELECT run_id, agent_type, model FROM dispatches"),
            [(res["run_id"], "atlas:verifier", "m-9")],
        )

    def test_arm_worktree_flag_sets_used_worktrees_only_when_given(self):
        omp_runstate.cmd_arm(self.ns())
        conn = atlas_db.connect()
        self.assertFalse(atlas_db.run_used_worktrees(conn, self.SID))
        conn.close()
        omp_runstate.cmd_arm(self.ns(worktree=True))
        conn = atlas_db.connect()
        self.assertTrue(atlas_db.run_used_worktrees(conn, self.SID))
        conn.close()

    # ---- cmd_event ----
    def test_event_empty_session_id_exact_error(self):
        self.assertEqual(
            omp_runstate.cmd_event(self.ns(session_id="")),
            {"ok": False, "error": "empty session id"},
        )

    def test_event_dispatch_tool_with_no_run_reports_reason(self):
        for tool in ("Agent", "Task"):
            res = omp_runstate.cmd_event(self.ns(tool=tool, dispatch="atlas:x"))
            self.assertEqual(res, {"ok": True, "logged": False, "reason": "no run"})
        self.assertEqual(self.rows("SELECT COUNT(*) FROM dispatches"), [(0,)])

    def test_event_dispatch_tool_logs_dispatch_row(self):
        run = omp_runstate.cmd_begin(self.ns())["run_id"]
        res = omp_runstate.cmd_event(
            self.ns(tool="Agent", dispatch="atlas:explorer", model="mm")
        )
        self.assertEqual(
            res, {"ok": True, "logged": True, "kind": "dispatch", "run_id": run}
        )
        self.assertEqual(
            self.rows("SELECT run_id, agent_type, model FROM dispatches"),
            [(run, "atlas:explorer", "mm")],
        )
        # log_dispatch's own bookkeeping row is not an inline op
        self.assertEqual(
            self.rows("SELECT tool, is_inline_op FROM events"),
            [("atlas:explorer", 0)],
        )

    def test_event_untracked_tool_reports_reason_and_writes_nothing(self):
        omp_runstate.cmd_begin(self.ns())
        res = omp_runstate.cmd_event(self.ns(tool="TodoWrite"))
        self.assertEqual(res, {"ok": True, "logged": False, "reason": "untracked tool"})
        self.assertEqual(self.rows("SELECT COUNT(*) FROM events"), [(0,)])
        self.assertEqual(self.rows("SELECT COUNT(*) FROM dispatches"), [(0,)])

    def test_event_inline_tool_without_open_run_reports_reason(self):
        res = omp_runstate.cmd_event(self.ns(tool="Edit", path="a.py"))
        self.assertEqual(res, {"ok": True, "logged": False, "reason": "no open run"})

    def test_event_each_inline_tool_is_logged_on_main_context(self):
        run = omp_runstate.cmd_begin(self.ns())["run_id"]
        for tool in sorted(omp_runstate.INLINE_TOOLS):
            res = omp_runstate.cmd_event(self.ns(tool=tool, path="p/" + tool))
            self.assertEqual(
                res, {"ok": True, "logged": True, "kind": "event", "run_id": run}, tool
            )
        got = self.rows(
            "SELECT tool, context, is_inline_op, path FROM events ORDER BY id"
        )
        self.assertEqual(
            got, [(t, "main", 1, "p/" + t) for t in sorted(omp_runstate.INLINE_TOOLS)]
        )

    # ---- cmd_snapshot ----
    def test_snapshot_returns_path_and_written_flag(self):
        with open(os.path.join(self.proj, "new.py"), "w") as fh:
            fh.write("1\n")
        res = omp_runstate.cmd_snapshot(self.ns())
        self.assertEqual(set(res), {"ok", "path", "written"})
        self.assertIs(res["ok"], True)
        self.assertIs(res["written"], True)
        self.assertEqual(res["path"], session_boot.snapshot_path(self.proj, self.SID))
        with open(res["path"]) as fh:
            self.assertEqual(json.load(fh), {"session": self.SID, "paths": mock.ANY})
        again = omp_runstate.cmd_snapshot(self.ns())
        self.assertEqual(again["written"], False)
        self.assertIsNone(again["path"])

    def test_snapshot_empty_session_id_writes_nothing(self):
        res = omp_runstate.cmd_snapshot(self.ns(session_id=""))
        self.assertEqual(res, {"ok": True, "path": None, "written": False})

    # ---- cmd_rebaseline ----
    def _snap_with(self, files):
        for rel, text in files.items():
            p = os.path.join(self.proj, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w") as fh:
                fh.write(text)

    def test_rebaseline_no_dirs_is_noop_even_with_changes(self):
        omp_runstate.cmd_snapshot(self.ns())
        self._snap_with({".serena/project.yml": "a\n"})
        with mock.patch.object(omp_runstate, "_tool_state_dirs", return_value=()):
            self.assertEqual(
                omp_runstate.cmd_rebaseline(self.ns()), {"ok": True, "absorbed": []}
            )
        with open(session_boot.snapshot_path(self.proj, self.SID)) as fh:
            self.assertNotIn(".serena/project.yml", json.load(fh)["paths"])

    def test_rebaseline_empty_session_id_is_noop(self):
        self.assertEqual(
            omp_runstate.cmd_rebaseline(self.ns(session_id="")),
            {"ok": True, "absorbed": []},
        )

    def test_rebaseline_absorbs_returns_sorted_and_updates_snapshot_hashes(self):
        omp_runstate.cmd_snapshot(self.ns())
        self._snap_with(
            {".serena/z.yml": "z\n", ".serena/a.yml": "a\n", "code.py": "c\n"}
        )
        res = omp_runstate.cmd_rebaseline(self.ns())
        self.assertEqual(
            res, {"ok": True, "absorbed": [".serena/a.yml", ".serena/z.yml"]}
        )
        with open(session_boot.snapshot_path(self.proj, self.SID)) as fh:
            snap = json.load(fh)
        now = session_boot.dirty_map(self.proj)
        self.assertEqual(snap["session"], self.SID)
        self.assertEqual(snap["paths"][".serena/a.yml"], now[".serena/a.yml"])
        self.assertEqual(snap["paths"][".serena/z.yml"], now[".serena/z.yml"])
        self.assertNotIn("code.py", snap["paths"])

    def test_rebaseline_matches_dir_segments_not_substrings(self):
        omp_runstate.cmd_snapshot(self.ns())
        self._snap_with(
            {"x.serena/y.py": "1\n", "serena/z.py": "2\n", "a/.serena/ok.yml": "3\n"}
        )
        res = omp_runstate.cmd_rebaseline(self.ns())
        self.assertEqual(res["absorbed"], ["a/.serena/ok.yml"])

    def test_rebaseline_unchanged_file_is_not_absorbed(self):
        self._snap_with({".serena/project.yml": "same\n"})
        omp_runstate.cmd_snapshot(self.ns())
        self.assertEqual(omp_runstate.cmd_rebaseline(self.ns())["absorbed"], [])

    def test_rebaseline_corrupt_snapshot_is_fail_open(self):
        omp_runstate.cmd_snapshot(self.ns())
        path = session_boot.snapshot_path(self.proj, self.SID)
        with open(path, "w") as fh:
            fh.write("{not json")
        self._snap_with({".serena/p.yml": "1\n"})
        self.assertEqual(
            omp_runstate.cmd_rebaseline(self.ns()), {"ok": True, "absorbed": []}
        )
        with open(path) as fh:
            self.assertEqual(fh.read(), "{not json")

    def test_rebaseline_snapshot_missing_paths_key_is_fail_open(self):
        omp_runstate.cmd_snapshot(self.ns())
        path = session_boot.snapshot_path(self.proj, self.SID)
        with open(path, "w") as fh:
            json.dump({"session": self.SID}, fh)
        self._snap_with({".serena/p.yml": "1\n"})
        self.assertEqual(omp_runstate.cmd_rebaseline(self.ns())["absorbed"], [])

    def test_rebaseline_uses_cwd_itself_when_no_docs_root_found(self):
        with (
            mock.patch("docs_drift.find_root", return_value=None) as fr,
            mock.patch.object(
                session_boot, "snapshot_path", return_value="/nonexistent/s.json"
            ) as sp,
        ):
            omp_runstate.cmd_rebaseline(self.ns())
        fr.assert_called_once()
        self.assertEqual(str(sp.call_args.args[0]), self.proj)
        self.assertEqual(sp.call_args.args[1], self.SID)

    # ---- COMMANDS / main ----
    def test_command_table_maps_names_to_functions(self):
        self.assertEqual(
            omp_runstate.COMMANDS,
            {
                "begin": omp_runstate.cmd_begin,
                "arm": omp_runstate.cmd_arm,
                "event": omp_runstate.cmd_event,
                "snapshot": omp_runstate.cmd_snapshot,
                "rebaseline": omp_runstate.cmd_rebaseline,
            },
        )

    def run_main(self, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = omp_runstate.main(argv)
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 1)
        return rc, json.loads(lines[0])

    def test_main_runs_begin_and_prints_one_json_line(self):
        rc, res = self.run_main(["begin", "--session-id", self.SID, "--cwd", self.proj])
        self.assertEqual(rc, 0)
        self.assertTrue(res["ok"] and res["created"])

    def test_main_arm_passes_all_options_through(self):
        rc, res = self.run_main(
            [
                "arm",
                "--session-id",
                self.SID,
                "--cwd",
                self.proj,
                "--agent-type",
                "atlas:a",
                "--model",
                "mx",
                "--worktree",
            ]
        )
        self.assertEqual(rc, 0)
        self.assertTrue(res["orchestrating"])
        self.assertEqual(
            self.rows("SELECT agent_type, model FROM dispatches"), [("atlas:a", "mx")]
        )

    def test_main_event_passes_tool_path_dispatch_model(self):
        self.run_main(["begin", "--session-id", self.SID, "--cwd", self.proj])
        _, res = self.run_main(
            [
                "event",
                "--session-id",
                self.SID,
                "--cwd",
                self.proj,
                "--tool",
                "Task",
                "--dispatch",
                "atlas:d",
                "--model",
                "mq",
            ]
        )
        self.assertEqual((res["logged"], res["kind"]), (True, "dispatch"))
        self.assertEqual(
            self.rows("SELECT agent_type, model FROM dispatches"), [("atlas:d", "mq")]
        )
        _, res = self.run_main(
            [
                "event",
                "--session-id",
                self.SID,
                "--cwd",
                self.proj,
                "--tool",
                "Read",
                "--path",
                "f.py",
            ]
        )
        self.assertEqual(res["kind"], "event")
        self.assertEqual(
            self.rows("SELECT path FROM events WHERE is_inline_op=1"), [("f.py",)]
        )

    def test_main_event_requires_tool(self):
        rc, res = self.run_main(["event", "--session-id", self.SID])
        self.assertEqual((rc, res), (0, {"ok": False, "error": "bad arguments"}))

    def test_main_snapshot_and_rebaseline_dispatch(self):
        _, snap = self.run_main(
            ["snapshot", "--session-id", self.SID, "--cwd", self.proj]
        )
        self.assertTrue(snap["written"])
        _, rb = self.run_main(
            ["rebaseline", "--session-id", self.SID, "--cwd", self.proj]
        )
        self.assertEqual(rb, {"ok": True, "absorbed": []})

    def test_main_default_session_id_is_empty_and_refused(self):
        _, res = self.run_main(["begin", "--cwd", self.proj])
        self.assertEqual(res, {"ok": False, "error": "empty session id"})

    def test_main_default_cwd_is_the_process_cwd(self):
        prev = os.getcwd()
        self.addCleanup(os.chdir, prev)
        os.chdir(self.proj)
        _, res = self.run_main(["snapshot", "--session-id", self.SID])
        self.assertTrue(res["written"])
        self.assertEqual(
            os.path.realpath(res["path"]),
            os.path.realpath(session_boot.snapshot_path(self.proj, self.SID)),
        )

    def test_main_no_subcommand_reports_usage_failure_exit_zero(self):
        rc, res = self.run_main([])
        self.assertEqual(rc, 0)
        self.assertEqual(res["ok"], False)
        self.assertEqual(
            res["error"],
            "ValueError: usage: omp_runstate.py begin|arm|event|snapshot ...",
        )

    def test_main_unknown_subcommand_is_bad_arguments(self):
        rc, res = self.run_main(["bogus"])
        self.assertEqual((rc, res), (0, {"ok": False, "error": "bad arguments"}))

    def test_main_command_exception_is_reported_not_raised(self):
        boom = mock.Mock(side_effect=RuntimeError("kaput"))
        with mock.patch.dict(omp_runstate.COMMANDS, {"begin": boom}):
            rc, res = self.run_main(["begin", "--session-id", "s"])
        self.assertEqual((rc, res), (0, {"ok": False, "error": "RuntimeError: kaput"}))


if __name__ == "__main__":
    unittest.main()
