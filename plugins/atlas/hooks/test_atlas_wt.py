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


if __name__ == "__main__":
    unittest.main()
