#!/usr/bin/env python3
"""Worktree hygiene of atlas_mux reap: auto-commit of dirty workers, dirty-lead snapshot base, conflicts, reap-stale."""
import contextlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402

import atlas_mux  # noqa: E402

_GIT_ENV = {
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
}
BASE = "".join(f"line {i}\n" for i in range(1, 31))


class HygieneTests(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        patcher = mock.patch.dict(os.environ, _GIT_ENV)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.repo = os.path.join(self.tmp, "repo")
        os.mkdir(self.repo)
        self.git("init", "-q", "-b", "main")
        pathlib.Path(self.repo, "f.txt").write_text(BASE)
        pathlib.Path(self.repo, ".gitignore").write_text(".atlas/\n")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "base")
        os.makedirs(os.path.join(self.repo, ".atlas", ".run", "teams"))

    def git(self, *a, cwd=None):
        return subprocess.run(["git", "-C", cwd or self.repo, *a], check=True, capture_output=True, text=True).stdout.strip()

    def branches(self):
        return self.git("branch", "--format=%(refname:short)").split()

    def team(self, team, members, dirty_lead=None, created=None):
        """members {name: (old, new, commit?)}; dirty_lead is applied to f.txt BEFORE the team is based."""
        rec = {"isolation": "worktree", "team_id": team, "transport": "tmux",
               "members": [{"name": n, "role": "implementer"} for n in members], "created": created or time.time()}
        rec["worktrees"] = atlas_mux.worktree_plan(rec, self.repo)
        if dirty_lead:
            f = pathlib.Path(self.repo, "f.txt")
            f.write_text(f.read_text().replace(*dirty_lead))
            pathlib.Path(self.repo, "untracked.txt").write_text("u\n")
        atlas_mux._apply_snapshot_base(self.repo, rec)
        for n, (old, new, commit) in members.items():
            wt = rec["worktrees"][n]
            self.assertIsNone(atlas_mux.add_worktree(self.repo, wt))
            f = pathlib.Path(wt["path"], "f.txt")
            f.write_text(f.read_text().replace(old, new))
            if commit:
                self.git("commit", "-q", "-am", f"{n} edit", cwd=wt["path"])
        pathlib.Path(self.repo, f".atlas/.run/teams/{team}.json").write_text(json.dumps(rec))
        return rec

    def run_cmd(self, *argv):
        buf = io.StringIO()
        fail = subprocess.CompletedProcess([], 1, "", "")
        with mock.patch.object(atlas_mux, "_tmux", return_value=fail), mock.patch.object(atlas_mux, "_kill_notes"), \
                contextlib.redirect_stdout(buf):
            self.assertEqual(0, atlas_mux.main([*argv, "--root", self.repo]))
        return json.loads(buf.getvalue().strip().splitlines()[-1])

    def test_dirty_worker_is_autocommitted_merged_and_removed(self):  # RC1
        rec = self.team("ta", {"implementer-1": ("line 2\n", "line 2 A\n", False)})
        out = self.run_cmd("reap", "--json", "--team", "ta")
        self.assertEqual(["implementer-1"], out["worktrees_autocommitted"])
        self.assertEqual(["implementer-1"], out["worktrees_merged"])
        self.assertEqual([], out["worktrees_kept"])
        self.assertIn("line 2 A\n", pathlib.Path(self.repo, "f.txt").read_text())
        self.assertFalse(os.path.exists(rec["worktrees"]["implementer-1"]["path"]))
        self.assertEqual(["main"], self.branches())

    def test_autocommit_survives_a_failing_pre_commit_hook(self):
        hooks = os.path.join(self.tmp, "hooks")
        os.mkdir(hooks)
        hook = pathlib.Path(hooks, "pre-commit")
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        self.git("config", "core.hooksPath", hooks)
        rec = self.team("tc", {"implementer-1": ("line 2\n", "line 2 H\n", False)})
        out = self.run_cmd("reap", "--json", "--team", "tc")
        self.assertEqual(["implementer-1"], out["worktrees_autocommitted"])
        self.assertEqual(["implementer-1"], out["worktrees_merged"])
        self.assertIn("line 2 H\n", pathlib.Path(self.repo, "f.txt").read_text())
        self.assertFalse(os.path.exists(rec["worktrees"]["implementer-1"]["path"]))

    def test_dirty_lead_gets_snapshot_base_and_worker_diff_is_applied(self):  # RC2
        head = self.git("rev-parse", "HEAD")
        rec = self.team("tb", {"implementer-1": ("line 28\n", "line 28 W\n", True)}, dirty_lead=("line 2\n", "line 2 L\n"))
        self.assertNotEqual(head, rec["base"])
        self.assertEqual(head, self.git("rev-parse", rec["base"] + "^"))
        # the worker started from the lead's dirty tree, untracked file included
        wt = rec["worktrees"]["implementer-1"]["path"]
        self.assertIn("line 2 L\n", pathlib.Path(wt, "f.txt").read_text())
        self.assertTrue(pathlib.Path(wt, "untracked.txt").exists())
        out = self.run_cmd("reap", "--json", "--team", "tb")
        self.assertEqual(["implementer-1"], out["worktrees_merged"])
        self.assertEqual([], out["worktrees_kept"])
        text = pathlib.Path(self.repo, "f.txt").read_text()
        self.assertIn("line 2 L\n", text)  # the lead's own uncommitted edit survived
        self.assertIn("line 28 W\n", text)
        self.assertEqual(head, self.git("rev-parse", "HEAD"))
        self.assertEqual(["main"], self.branches())
        self.assertFalse(os.path.exists(wt))

    def test_true_conflict_keeps_worktree_and_branch_and_reports_files(self):
        rec = self.team("tc", {"implementer-1": ("line 5\n", "line 5 W\n", True)}, dirty_lead=("line 2\n", "line 2 L\n"))
        f = pathlib.Path(self.repo, "f.txt")  # the lead edits the same line after the team was based
        f.write_text(f.read_text().replace("line 5\n", "line 5 L\n"))
        out = self.run_cmd("reap", "--json", "--team", "tc")
        self.assertEqual(["f.txt"], out["worktrees_conflicted"][0]["files"])
        self.assertEqual(1, len(out["worktrees_kept"]))
        self.assertIn("apply", out["worktrees_kept"][0]["finish"])
        wt = rec["worktrees"]["implementer-1"]
        self.assertTrue(os.path.isdir(wt["path"]))
        self.assertIn(wt["branch"], self.branches())
        text = pathlib.Path(self.repo, "f.txt").read_text()
        self.assertIn("line 5 L\n", text)  # lead file untouched, no markers
        self.assertNotIn("<<<<<<<", text)

    def test_spawn_team_bases_worktrees_on_dirty_lead_snapshot(self):  # RC2 through the real spawn path
        head = self.git("rev-parse", "HEAD")
        f = pathlib.Path(self.repo, "f.txt")
        f.write_text(f.read_text().replace("line 2\n", "line 2 L\n"))  # uncommitted lead edit
        seen = []

        def fake_spawn(ns):
            seen.append(ns)
            print(json.dumps({"ok": True, "name": ns.name}))
            return 0

        real = atlas_mux.atlas_resolve.resolve  # shipped cells are isolation=shared; opt in to worktrees
        env = {"ATLAS_COLONY_TRANSPORT": "claude-bg", "ATLAS_MUX": "on", "ATLAS_ISOLATION": ""}
        with mock.patch.object(atlas_mux.atlas_resolve, "resolve", lambda *a, **k: dict(real(*a, **k), isolation="worktree")), \
                mock.patch.dict(os.environ, env), mock.patch.object(atlas_mux, "cmd_spawn", fake_spawn), \
                mock.patch.object(atlas_mux, "_lead_run", return_value=(None, "sess-hy")), \
                contextlib.redirect_stdout(io.StringIO()):
            code = atlas_mux.main(["spawn-team", "--json", "--class", "implement", "--effort", "medium",
                                   "--task", "## member: implementer-1\nslice one\n## member: implementer-2\nslice two",
                                   "--team-id", "te", "--root", self.repo])
        self.assertEqual(0, code)
        rec = json.loads(pathlib.Path(self.repo, ".atlas/.run/teams/te.json").read_text())
        self.assertNotEqual(head, rec["base"])
        self.assertEqual(head, self.git("rev-parse", rec["base"] + "^"))
        wt = next(iter(rec["worktrees"].values()))["path"]
        self.assertIn("line 2 L\n", pathlib.Path(wt, "f.txt").read_text())

    def test_reap_stale_reaps_a_team_whose_session_is_gone(self):  # RC3
        rec = self.team("td", {"implementer-1": ("line 2\n", "line 2 A\n", False)}, created=time.time() - 1000)
        out = self.run_cmd("reap-stale", "--json")
        self.assertEqual(["td"], out["reaped"])
        self.assertFalse(os.path.exists(rec["worktrees"]["implementer-1"]["path"]))
        self.assertIn("line 2 A\n", pathlib.Path(self.repo, "f.txt").read_text())
        self.assertEqual([], out["notes"])
        self.assertEqual([], self.run_cmd("reap-stale", "--json")["reaped"])  # idempotent: record is archived


if __name__ == "__main__":
    unittest.main()
