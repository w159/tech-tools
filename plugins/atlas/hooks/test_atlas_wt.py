"""atlas_wt.py worktree flow + completion_gate (q) unmerged-branch condition."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import completion_gate  # noqa: E402

WT = str(SCRIPTS / "atlas_wt.py")


def sh(cwd, *args):
    return subprocess.run(
        list(args), cwd=cwd, capture_output=True, text=True, check=True
    ).stdout.strip()


def make_repo():
    d = Path(tempfile.mkdtemp()).resolve()
    sh(d, "git", "init", "-q", "-b", "main")
    sh(d, "git", "config", "user.email", "t@t")
    sh(d, "git", "config", "user.name", "t")
    (d / "docs").mkdir()
    (d / "a.txt").write_text("a\n")
    (d / ".gitignore").write_text(".atlas/\n")
    sh(d, "git", "add", "-A")
    sh(d, "git", "commit", "-qm", "init")
    return d


def wt(root, *args):
    return subprocess.run(
        [sys.executable, WT, "--root", str(root), *args], capture_output=True, text=True
    )


def commit_in_worker(root, agent):
    p = root / ".atlas" / "wt" / agent
    (p / "w.txt").write_text(agent + "\n")
    sh(p, "git", "add", "w.txt")
    sh(p, "git", "commit", "-qm", "work " + agent)


def verify(root, title, status="verified"):
    f = root / ".atlas" / ".run" / "findings.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(
        json.dumps([{"id": "V1", "status": status, "title": title, "evidence": []}])
    )


class WtTests(unittest.TestCase):
    def test_add_creates_branch_and_worktree_idempotent(self):
        r = make_repo()
        p = wt(r, "add", "alice")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue((r / ".atlas" / "wt" / "alice" / "a.txt").exists())
        self.assertIn("worker/alice", sh(r, "git", "branch", "--list", "worker/*"))
        again = wt(r, "add", "alice")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertFalse(json.loads(again.stdout)["created"])

    def test_merge_refuses_without_verified_finding(self):
        r = make_repo()
        wt(r, "add", "bob")
        commit_in_worker(r, "bob")
        verify(r, "worker/bob looks fine", status="open")
        p = wt(r, "merge", "bob")
        self.assertEqual(p.returncode, 1)
        self.assertIn("no verified finding", p.stderr)
        self.assertIn("worker/bob", sh(r, "git", "branch", "--list", "worker/*"))

    def test_merge_succeeds_with_verified_finding(self):
        r = make_repo()
        wt(r, "add", "carol")
        commit_in_worker(r, "carol")
        verify(r, "verified worker/carol unit")
        p = wt(r, "merge", "carol")
        self.assertEqual(p.returncode, 0, p.stderr)
        sha = json.loads(p.stdout)["merge_commit"]
        self.assertEqual(sha, sh(r, "git", "rev-parse", "HEAD"))
        self.assertTrue((r / "w.txt").exists())
        self.assertEqual(sh(r, "git", "branch", "--list", "worker/*"), "")
        self.assertFalse((r / ".atlas" / "wt" / "carol").exists())

    def test_merge_refuses_dirty_worktree(self):
        r = make_repo()
        wt(r, "add", "dan")
        commit_in_worker(r, "dan")
        (r / ".atlas" / "wt" / "dan" / "x.txt").write_text("x")
        verify(r, "worker/dan ok")
        p = wt(r, "merge", "dan")
        self.assertEqual(p.returncode, 1)
        self.assertIn("uncommitted", p.stderr)

    def test_gate_blocks_on_unmerged_and_passes_when_none(self):
        r = make_repo()
        self.assertEqual(completion_gate._unmerged_worker_branches(r), [])
        wt(r, "add", "erin")
        commit_in_worker(r, "erin")
        rows = completion_gate._unmerged_worker_branches(r)
        self.assertEqual([x["branch"] for x in rows], ["worker/erin"])
        msg = completion_gate._unmerged_reason_part(rows)
        self.assertIn("worker/erin", msg)
        self.assertIn("merge <agent>", msg)
        os.environ["ATLAS_WT_GATE"] = "off"
        try:
            self.assertEqual(completion_gate._unmerged_worker_branches(r), [])
        finally:
            del os.environ["ATLAS_WT_GATE"]
        verify(r, "worker/erin verified")
        self.assertEqual(wt(r, "merge", "erin").returncode, 0)
        self.assertEqual(completion_gate._unmerged_worker_branches(r), [])

    def test_prune_removes_merged_orphan_branch(self):
        r = make_repo()
        sh(r, "git", "branch", "worker/zed")
        out = json.loads(wt(r, "prune").stdout)
        self.assertEqual(out["pruned_branches"], ["worker/zed"])


def wt_env(root, extra, *args):
    return subprocess.run(
        [sys.executable, WT, "--root", str(root), *args],
        capture_output=True,
        text=True,
        env=dict(os.environ, **extra),
    )


class WtGitHygieneTests(unittest.TestCase):
    def test_add_base_defaults_to_the_default_branch_not_a_literal_main(self):
        r = Path(tempfile.mkdtemp()).resolve()
        sh(r, "git", "init", "-q", "-b", "trunk")  # no `main` here
        sh(r, "git", "config", "user.email", "t@t")
        sh(r, "git", "config", "user.name", "t")
        (r / ".gitignore").write_text(".atlas/\n")
        (r / "a.txt").write_text("a\n")
        sh(r, "git", "add", "-A")
        sh(r, "git", "commit", "-qm", "init")
        trunk = sh(r, "git", "rev-parse", "trunk")
        sh(r, "git", "switch", "-q", "-c", "feature")  # the lead is elsewhere, with its own commit
        (r / "f.txt").write_text("f\n")
        sh(r, "git", "add", "f.txt")
        sh(r, "git", "commit", "-qm", "feature work")
        p = wt(r, "add", "ann")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(sh(r, "git", "rev-parse", "worker/ann"), trunk)

    def test_add_base_flag_still_wins(self):
        r = make_repo()
        sh(r, "git", "switch", "-q", "-c", "other")
        (r / "o.txt").write_text("o\n")
        sh(r, "git", "add", "o.txt")
        sh(r, "git", "commit", "-qm", "other")
        self.assertEqual(wt(r, "add", "bea", "--base", "other").returncode, 0)
        self.assertEqual(sh(r, "git", "rev-parse", "worker/bea"), sh(r, "git", "rev-parse", "other"))

    def test_add_respects_the_worktree_cap(self):
        r = make_repo()
        env = {"ATLAS_GIT_MAX_WORKTREES": "1"}
        self.assertEqual(wt_env(r, env, "add", "cal").returncode, 0)
        commit_in_worker(r, "cal")  # unmerged work: a clean cannot reclaim the slot
        p = wt_env(r, env, "add", "dee")
        self.assertEqual(p.returncode, 1)
        self.assertIn("cap 1", p.stderr)
        self.assertFalse((r / ".atlas" / "wt" / "dee").exists())
        self.assertEqual(sh(r, "git", "branch", "--list", "worker/dee"), "")
        self.assertEqual(wt_env(r, env, "add", "cal").returncode, 0)  # an existing worktree is not a new one

    def test_add_gitignores_the_worktree_dir_only_when_needed(self):
        r = make_repo()  # .gitignore already has .atlas/
        before = (r / ".gitignore").read_text()
        wt(r, "add", "eli")
        self.assertEqual((r / ".gitignore").read_text(), before)

        r2 = make_repo()
        (r2 / ".gitignore").write_text("node_modules/")  # no trailing newline, no .atlas rule
        sh(r2, "git", "add", ".gitignore")
        sh(r2, "git", "commit", "-qm", "ignore")
        self.assertEqual(wt(r2, "add", "fay").returncode, 0)
        self.assertEqual((r2 / ".gitignore").read_text(), "node_modules/\n.atlas/wt/\n")
        self.assertEqual(sh(r2, "git", "status", "--porcelain", "--untracked-files=all"), "M .gitignore")
        wt(r2, "add", "gus")
        self.assertEqual((r2 / ".gitignore").read_text().count(".atlas/wt/"), 1)

    def test_prune_also_removes_clean_merged_worktrees_but_not_work(self):
        r = make_repo()
        env = {"ATLAS_GIT_WORKTREE_IDLE_MINUTES": "0"}
        wt(r, "add", "hal")  # nothing committed: merged
        wt(r, "add", "ivy")
        commit_in_worker(r, "ivy")  # unmerged
        wt(r, "add", "jon")
        (r / ".atlas" / "wt" / "jon" / "scratch.txt").write_text("x")  # dirty
        out = json.loads(wt_env(r, env, "prune").stdout)
        self.assertEqual([Path(x).name for x in out["worktrees_removed"]], ["hal"])
        self.assertFalse((r / ".atlas" / "wt" / "hal").exists())
        self.assertEqual(sh(r, "git", "branch", "--list", "worker/hal"), "")
        for kept in ("ivy", "jon"):
            self.assertTrue((r / ".atlas" / "wt" / kept).exists())
            self.assertIn("worker/" + kept, sh(r, "git", "branch", "--list", "worker/*"))

    def test_prune_keeps_a_recently_used_worktree_by_default(self):
        r = make_repo()
        wt(r, "add", "kim")
        out = json.loads(wt(r, "prune").stdout)
        self.assertEqual(out["worktrees_removed"], [])
        self.assertTrue((r / ".atlas" / "wt" / "kim").exists())

    def test_team_style_agent_names_flow_through_status(self):
        r = make_repo()
        self.assertEqual(wt(r, "add", "tabc123-implementer-1").returncode, 0)
        rows = json.loads(wt(r, "status").stdout)
        self.assertEqual([x["branch"] for x in rows], ["worker/tabc123-implementer-1"])


if __name__ == "__main__":
    unittest.main()
