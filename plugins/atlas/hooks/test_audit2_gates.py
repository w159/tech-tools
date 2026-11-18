"""Audit 2026-11-17 gate fixes: shared READ_ONLY_ROLES, agent-string normalization, bold GOAL board title,
team-observation bookkeeping, and inherited dirt not counted as this run's work."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import completion_gate_core as cgc  # noqa: E402
import dispatch_tripwire_core as core  # noqa: E402

PROMPT = (
    "GOAL: do the thing.\nDELIVERABLE: x\nSUCCESS CRITERIA: y\nOUT OF SCOPE: z\n"
    "STOP CONDITIONS: s\n"
)


class ReadOnlyRolesTest(unittest.TestCase):
    def test_one_definition(self):
        self.assertIs(core.READ_ONLY_ROLES, cgc.READ_ONLY_ROLES)
        self.assertEqual(core.READ_ONLY_ROLES, frozenset({"explorer", "db-prober"}))


class AgentNormalizationTest(unittest.TestCase):
    def test_variants_get_the_same_verdict(self):
        for scope, want_empty in (("", False), ("SCOPE: implement/medium\n", True)):
            base = core._scope_problem({"subagent_type": "atlas:implementer", "prompt": PROMPT + scope})
            for agent in (
                "atlas:implementer",
                "ATLAS:implementer",
                " atlas:implementer ",
                "Atlas:Implementer",
            ):
                with self.subTest(agent=agent, scope=scope):
                    v = core._scope_problem(
                        {"subagent_type": agent, "prompt": PROMPT + scope}
                    )
                    self.assertEqual(v == "", want_empty)
                    self.assertEqual(v, base)

    def test_non_atlas_agent_is_untouched(self):
        self.assertEqual(core._scope_problem({"subagent_type": "general-purpose"}), "")
        self.assertEqual(core._norm_agent(" ATLAS: Explorer "), "atlas:explorer")
        self.assertTrue(core._is_read_only_role(" ATLAS:Explorer "))


class BoldGoalTitleTest(unittest.TestCase):
    def test_board_title_from_bold_goal(self):
        import atlas_todo

        captured = {}

        def fake_add(root, title, **kw):
            captured["title"] = title
            return {"ok": False}

        payload = {
            "hook_event_name": "PreToolUse",
            "tool_name": "Agent",
            "session_id": "s",
            "cwd": tempfile.mkdtemp(),
            "tool_input": {
                "subagent_type": "atlas:implementer",
                "name": "impl-x",
                "prompt": "**GOAL:** fix the widget.\nDELIVERABLE: x\n",
            },
        }
        env = {k: v for k, v in os.environ.items() if k not in ("ATLAS_CHANNELS", "ATLAS_HARNESS")}
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(atlas_todo, "find_root", return_value=Path(payload["cwd"])),
            mock.patch.object(atlas_todo, "open_lead_channel", return_value={"name": "c"}),
            mock.patch.object(atlas_todo, "channel_brief", return_value="BRIEF"),
            mock.patch.object(atlas_todo, "add", side_effect=fake_add),
        ):
            out = core._channel_dispatch(payload)
        self.assertIsNotNone(out)
        self.assertEqual(captured["title"], "fix the widget.")


class BookkeepingTest(unittest.TestCase):
    def bk(self, cmd):
        return core._is_bookkeeping_call("Bash", {"command": cmd})

    def test_team_observation_is_bookkeeping(self):
        for cmd in (
            "python3 /a/scripts/atlas_crew.py wait --crew c1",
            "python3 /a/scripts/atlas_crew.py status",
            "python3 /a/scripts/atlas_mux.py status",
            "python3 /a/scripts/atlas_mux.py wait",
            "python3 /a/scripts/atlas_mux.py reap",
            "python3 /a/scripts/atlas_irc.py say hi",
            "python3 /a/scripts/atlas_crew.py wait | tail -5",
        ):
            with self.subTest(cmd=cmd):
                self.assertTrue(self.bk(cmd))

    def test_other_shell_work_still_counts(self):
        for cmd in (
            "python3 /a/scripts/atlas_crew.py wait && rm -rf x",
            "python3 /a/scripts/atlas_crew.py cleanup",
            "python3 /a/scripts/other.py status",
            "touch a.txt",
        ):
            with self.subTest(cmd=cmd):
                self.assertFalse(self.bk(cmd))


GIT_ENV = dict(
    os.environ,
    GIT_AUTHOR_NAME="t",
    GIT_AUTHOR_EMAIL="t@t",
    GIT_COMMITTER_NAME="t",
    GIT_COMMITTER_EMAIL="t@t",
)


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, env=GIT_ENV)


class InheritedDirtTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        git(self.root, "init", "-q", "-b", "main")
        (self.root / "a.py").write_text("a = 1\n")
        git(self.root, "add", "a.py")
        git(self.root, "commit", "-qm", "init")
        (self.root / "a.py").write_text("a = 2\n")  # modified before the session
        (self.root / "new.py").write_text("n = 1\n")  # untracked before the session
        import session_boot

        self.sb = session_boot
        run = self.root / ".atlas" / ".run"
        run.mkdir(parents=True)
        Path(session_boot.snapshot_path(self.root, "s1")).write_text(
            json.dumps({"paths": session_boot.dirty_map(self.root)})
        )

    def test_unchanged_inherited_dirt_is_not_this_runs(self):
        self.assertEqual(sorted(cgc._git_fallback_paths(self.root, "s1")), [])
        self.assertFalse(cgc._nondocs_changed(cgc._git_fallback_paths(self.root, "s1")))

    def test_a_file_changed_during_the_run_counts(self):
        (self.root / "a.py").write_text("a = 3\n")
        (self.root / "b.py").write_text("b = 1\n")
        self.assertEqual(sorted(cgc._git_fallback_paths(self.root, "s1")), ["a.py", "b.py"])
        self.assertTrue(cgc._nondocs_changed(cgc._git_fallback_paths(self.root, "s1")))

    def test_no_snapshot_keeps_every_git_path(self):
        self.assertEqual(sorted(cgc._git_fallback_paths(self.root, "other")), ["a.py", "new.py"])

    def test_run_written_paths_fallback_uses_the_snapshot(self):
        import atlas_db

        db = os.path.join(tempfile.mkdtemp(), "t.db")
        c = atlas_db.connect(db)
        atlas_db.init(c)
        c.close()
        with mock.patch.dict(os.environ, {"ATLAS_DB": db}):
            self.assertEqual(sorted(cgc._run_written_paths("no-such-session-x", self.root)), ["a.py", "new.py"])
            self.assertEqual(sorted(cgc._run_written_paths("s1", self.root)), [])


if __name__ == "__main__":
    unittest.main()
