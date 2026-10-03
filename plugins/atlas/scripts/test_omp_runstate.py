"""omp_runstate must leave atlas.db and .atlas/.run in exactly the state the
Claude hooks (session_boot, dispatch_tripwire) would, so completion_gate sees an
omp session the same way it sees a Claude one."""

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
        argv = [sys.executable, RUNSTATE, cmd, "--session-id", self.SID if sid is None else sid,
                "--cwd", cwd or self.proj, *extra]
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
        self.assertEqual(self.query("SELECT COUNT(*) FROM runs WHERE session_id=?", self.SID), [(1,)])

    def test_begin_after_run_finalized_starts_a_new_run_like_session_boot(self):
        """session_boot guards on current_run_id (open runs only), so a resumed
        session whose run was finalized by Stop gets a fresh run. Same here."""
        self.run_cli("begin")
        conn = atlas_db.connect()
        atlas_db.finalize_run(conn, atlas_db.current_run_id(conn, self.SID))
        conn.close()
        again = self.run_cli("begin")
        self.assertTrue(again["created"])
        self.assertEqual(self.query("SELECT COUNT(*) FROM runs WHERE session_id=?", self.SID), [(2,)])

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
        self.assertTrue(os.path.exists(os.path.join(self.proj, ".atlas", ".run", "atlas-orchestrate.active")))

    def test_arm_without_begin_creates_the_run(self):
        res = self.run_cli("arm")
        self.assertTrue(res["ok"])
        self.assertEqual(self.query("SELECT COUNT(*), SUM(orchestrating) FROM runs"), [(1, 1)])

    def test_arm_with_agent_type_and_worktree_records_dispatch_and_flag(self):
        self.run_cli("begin")
        self.run_cli("arm", "--agent-type", "atlas:implementer", "--model", "m-1", "--worktree")
        self.assertEqual(self.query("SELECT agent_type, model FROM dispatches"), [("atlas:implementer", "m-1")])
        conn = atlas_db.connect()
        self.assertTrue(atlas_db.run_used_worktrees(conn, self.SID))
        conn.close()

    # ---- event ---------------------------------------------------------
    def test_event_logs_inline_ops_with_path_on_main_context(self):
        self.run_cli("begin")
        self.run_cli("event", "--tool", "Edit", "--path", "src/a.py")
        self.run_cli("event", "--tool", "Bash")
        rows = self.query("SELECT tool, context, is_inline_op, path FROM events ORDER BY id")
        self.assertEqual(rows, [("Edit", "main", 1, "src/a.py"), ("Bash", "main", 1, None)])
        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, self.SID)
        self.assertEqual(atlas_db.run_changed_paths(conn, rid), ["src/a.py"])
        conn.close()

    def test_event_ignores_untracked_tools_and_missing_run(self):
        self.assertEqual(self.run_cli("event", "--tool", "Edit", "--path", "p")["logged"], False)  # no run yet
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
        self.assertEqual(self.query("SELECT agent_type FROM dispatches"), [("atlas:verifier",)])
        # an inline op needs an OPEN run, so it is not attributed to the closed one
        self.assertFalse(self.run_cli("event", "--tool", "Edit", "--path", "x")["logged"])

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
        self.assertEqual(sorted(res["absorbed"]), [".serena/.gitignore", ".serena/project.yml"])
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
        self.assertFalse(self.run_cli("rebaseline")["absorbed"])  # no snapshot: nothing to rebaseline
        self._write("pre.py")
        self.run_cli("snapshot", sid="s2")
        self.run_cli("rebaseline", sid="s2")
        with open(session_boot.snapshot_path(self.proj, "s2")) as fh:
            self.assertIn("pre.py", json.load(fh)["paths"])  # entries the snapshot already held survive

    def test_rebaseline_absorbs_tool_state_already_in_the_snapshot_whose_content_changed(self):
        # serena rewrites project.yml each session: a file present at SessionStart can differ by Stop
        self._write(".serena/project.yml", "before\n")
        self.run_cli("snapshot")
        self.assertIn(".serena/project.yml", self._snapshot_paths())
        self._write(".serena/project.yml", "after\n")
        self.assertEqual(self._gate_diff(), [".serena/project.yml"])  # what the gate would wrongly count
        res = self.run_cli("rebaseline")
        self.assertEqual(res["absorbed"], [".serena/project.yml"])
        self.assertEqual(self._gate_diff(), [])

    def test_rebaseline_never_rewrites_a_changed_code_file_already_in_the_snapshot(self):
        self._write("src/app.py", "v1\n")
        self.run_cli("snapshot")
        self._write("src/app.py", "v2\n")  # the lead edited it through the shell after the snapshot
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
        proc = subprocess.run([sys.executable, RUNSTATE, "begin", "--session-id", "s", "--cwd", self.proj],
                              capture_output=True, text=True, env=bad_env)
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(json.loads(proc.stdout)["ok"])
        proc = subprocess.run([sys.executable, RUNSTATE, "bogus"], capture_output=True, text=True, env=self.env)
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(json.loads(proc.stdout)["ok"])


if __name__ == "__main__":
    unittest.main()
