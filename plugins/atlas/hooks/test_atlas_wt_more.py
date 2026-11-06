"""In-process atlas_wt tests: every helper and command called directly against throwaway git repos
(the sibling test drives the CLI as a subprocess)."""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_wt as w  # noqa: E402


def sh(cwd, *args):
    return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Repo(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name).resolve() / "repo"
        self.root.mkdir()
        sh(self.root, "git", "init", "-q", "-b", "main")
        sh(self.root, "git", "config", "user.email", "t@t")
        sh(self.root, "git", "config", "user.name", "t")
        sh(self.root, "git", "config", "commit.gpgsign", "false")
        (self.root / "a.txt").write_text("a\n")
        (self.root / ".gitignore").write_text(".atlas/\n")
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-qm", "init")

    def commit_in(self, agent, name="w.txt", text=None):
        p = self.root / ".atlas" / "wt" / agent
        (p / name).write_text(text if text is not None else agent + "\n")
        sh(p, "git", "add", name)
        sh(p, "git", "commit", "-qm", "work " + agent)

    def verify(self, title, status="verified", evidence=None, fid="V1"):
        f = self.root.joinpath(*w.RELPATH)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps([{"id": fid, "status": status, "title": title, "evidence": evidence or []}]))


class SmallHelpersTest(Repo):
    def test_check_agent_accepts_and_rejects(self):
        for ok in ("alice", "a", "team-member.1", "A_b", "9lives"):
            w._check_agent(ok)
        for bad in ("", "-x", ".x", "a b", "a/b", "a..b", "x.lock", "né"):
            with self.assertRaises(w.WtError, msg=bad) as cm:
                w._check_agent(bad)
            self.assertIn("invalid agent name %r" % bad, str(cm.exception))

    def test_wt_path(self):
        self.assertEqual(w.wt_path(self.root, "bob"), self.root / ".atlas" / "wt" / "bob")

    def test_git_raises_with_exit_code_and_stderr_unless_check_false(self):
        with self.assertRaises(w.WtError) as cm:
            w.git(self.root, "rev-parse", "--verify", "nope-ref")
        self.assertIn("git rev-parse --verify nope-ref failed (exit 128)", str(cm.exception))
        self.assertNotEqual(w.git(self.root, "rev-parse", "--verify", "nope-ref", check=False).returncode, 0)
        self.assertEqual(w.git(self.root, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip(), "main")

    def test_branch_exists(self):
        self.assertTrue(w._branch_exists(self.root, "main"))
        self.assertFalse(w._branch_exists(self.root, "worker/none"))
        sh(self.root, "git", "branch", "worker/x")
        self.assertTrue(w._branch_exists(self.root, "worker/x"))


class MainRootTest(Repo):
    def test_from_root_subdir_and_worktree(self):
        sub = self.root / "docs"
        sub.mkdir()
        self.assertEqual(w.main_root(self.root), self.root)
        self.assertEqual(w.main_root(sub), self.root)
        w.cmd_add(self.root, "alice")
        self.assertEqual(w.main_root(self.root / ".atlas" / "wt" / "alice"), self.root)

    def test_not_a_repo(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(w.WtError) as cm:
                w.main_root(Path(td))
        self.assertIn("not inside a git repository", str(cm.exception))

    def test_separate_git_dir_falls_back_to_toplevel(self):
        with tempfile.TemporaryDirectory() as td:
            work, gd = Path(td).resolve() / "work", Path(td).resolve() / "elsewhere"
            work.mkdir()
            sh(work, "git", "init", "-q", "--separate-git-dir", str(gd))
            self.assertEqual(w.main_root(work), work)


class RegisteredIgnoredTest(Repo):
    def test_registered_matches_only_real_worktrees(self):
        w.cmd_add(self.root, "alice")
        self.assertTrue(w._registered(self.root, w.wt_path(self.root, "alice")))
        self.assertFalse(w._registered(self.root, w.wt_path(self.root, "ghost")))
        self.assertTrue(w._registered(self.root, self.root))  # the main tree is itself listed

    def test_ensure_ignored_existing_rule_is_enough(self):
        self.assertFalse(w.ensure_ignored(self.root))
        self.assertEqual((self.root / ".gitignore").read_text(), ".atlas/\n")

    def test_ensure_ignored_appends_rule(self):
        (self.root / ".gitignore").write_text("build")
        self.assertTrue(w.ensure_ignored(self.root))
        self.assertEqual((self.root / ".gitignore").read_text(), "build\n.atlas/wt/\n")
        self.assertFalse(w.ensure_ignored(self.root))

    def test_ensure_ignored_creates_missing_file_and_keeps_trailing_newline(self):
        (self.root / ".gitignore").unlink()
        self.assertTrue(w.ensure_ignored(self.root))
        self.assertEqual((self.root / ".gitignore").read_text(), ".atlas/wt/\n")
        (self.root / ".gitignore").write_text("x\n")
        sh(self.root, "git", "rm", "-q", "--cached", "-f", ".gitignore")
        # a fresh rule is appended once without a blank line
        (self.root / ".gitignore").write_text("x\n")
        self.assertTrue(w.ensure_ignored(self.root))
        self.assertEqual((self.root / ".gitignore").read_text(), "x\n.atlas/wt/\n")


class DefaultBaseTest(Repo):
    def test_default_branch_name_returned(self):
        self.assertEqual(w.default_base(self.root), "main")

    def test_falls_back_to_head(self):
        with mock.patch.object(w.atlas_git, "default_branch", return_value=None):
            self.assertEqual(w.default_base(self.root), "HEAD")
        with mock.patch.object(w.atlas_git, "default_branch", side_effect=RuntimeError("x")):
            self.assertEqual(w.default_base(self.root), "HEAD")
        with mock.patch.object(w, "atlas_git", None):
            self.assertEqual(w.default_base(self.root), "HEAD")


class CmdAddTest(Repo):
    def test_creates_branch_worktree_and_reports_created(self):
        out = w.cmd_add(self.root, "alice")
        self.assertEqual(out, {"agent": "alice", "branch": "worker/alice", "worktree": str(self.root / ".atlas" / "wt" / "alice"), "created": True})
        self.assertTrue((self.root / ".atlas" / "wt" / "alice" / "a.txt").exists())
        self.assertEqual(sh(self.root, "git", "branch", "--list", "worker/*").strip("+* "), "worker/alice")

    def test_second_call_is_idempotent_not_created(self):
        w.cmd_add(self.root, "alice")
        out = w.cmd_add(self.root, "alice")
        self.assertIs(out["created"], False)
        self.assertEqual(out["branch"], "worker/alice")

    def test_existing_worktree_on_other_branch_is_refused(self):
        out = w.cmd_add(self.root, "alice")
        sh(out["worktree"], "git", "checkout", "-q", "-b", "elsewhere")
        with self.assertRaises(w.WtError) as cm:
            w.cmd_add(self.root, "alice")
        self.assertIn("'elsewhere', not 'worker/alice'", str(cm.exception))

    def test_unregistered_directory_is_refused(self):
        (self.root / ".atlas" / "wt" / "bob").mkdir(parents=True)
        with self.assertRaises(w.WtError) as cm:
            w.cmd_add(self.root, "bob")
        self.assertIn("is not a registered worktree", str(cm.exception))

    def test_base_is_honoured_and_existing_branch_reused(self):
        (self.root / "b.txt").write_text("b")
        sh(self.root, "git", "add", "b.txt")
        sh(self.root, "git", "commit", "-qm", "second")
        first = sh(self.root, "git", "rev-parse", "HEAD~1")
        out = w.cmd_add(self.root, "old", base=first)
        self.assertFalse((Path(out["worktree"]) / "b.txt").exists())
        sh(self.root, "git", "branch", "worker/pre", "HEAD")
        out = w.cmd_add(self.root, "pre", base=first)
        self.assertTrue((Path(out["worktree"]) / "b.txt").exists())  # existing branch wins over base

    def test_invalid_name_and_policy_denial(self):
        with self.assertRaises(w.WtError):
            w.cmd_add(self.root, "../evil")
        with mock.patch.object(w.atlas_git, "check_action", return_value={"decision": "deny", "reason": "cap reached"}) as ca:
            with self.assertRaises(w.WtError) as cm:
                w.cmd_add(self.root, "carl")
        self.assertEqual(str(cm.exception), "cap reached")
        self.assertEqual(ca.call_args[0], (self.root, "worktree"))
        self.assertFalse((self.root / ".atlas" / "wt" / "carl").exists())

    def test_policy_ask_and_missing_policy_module_allow_creation(self):
        with mock.patch.object(w.atlas_git, "check_action", return_value={"decision": "ask", "reason": "r"}):
            self.assertTrue(w.cmd_add(self.root, "dina")["created"])
        with mock.patch.object(w, "atlas_git", None):
            self.assertTrue(w.cmd_add(self.root, "ed")["created"])

    def test_add_gitignores_worktree_dir_when_needed(self):
        (self.root / ".gitignore").write_text("")
        w.cmd_add(self.root, "fay")
        self.assertIn(".atlas/wt/", (self.root / ".gitignore").read_text())


class VerifiedFindingTest(Repo):
    def test_title_and_evidence_matching(self):
        self.verify("worker/alice is fine")
        self.assertEqual(w._verified_finding(self.root, "alice"), "V1")
        self.verify("something", evidence=["ran tests on worker/alice branch"])
        self.assertEqual(w._verified_finding(self.root, "alice"), "V1")
        self.verify("something", evidence="plain alice evidence")
        self.assertEqual(w._verified_finding(self.root, "alice"), "V1")

    def test_name_boundaries(self):
        for title in ("alice2 ok", "malice ok", "alice.x ok", "alice-b ok", "worker/alice-b ok"):
            self.verify(title)
            self.assertIsNone(w._verified_finding(self.root, "alice"), title)
        for title in ("alice", "(alice)", "see worker/alice,", "alice, bob"):
            self.verify(title)
            self.assertEqual(w._verified_finding(self.root, "alice"), "V1", title)

    def test_only_verified_status_counts_and_junk_rows_skipped(self):
        for st in ("open", "dismissed", None):
            self.verify("worker/alice", status=st)
            self.assertIsNone(w._verified_finding(self.root, "alice"), st)
        f = self.root.joinpath(*w.RELPATH)
        f.write_text(json.dumps(["junk", 5, {"id": "V9", "status": "verified", "title": None, "evidence": None}, {"id": "V2", "status": "verified", "title": "worker/alice"}]))
        self.assertEqual(w._verified_finding(self.root, "alice"), "V2")

    def test_no_findings_file(self):
        self.assertIsNone(w._verified_finding(self.root, "alice"))

    def test_agent_name_is_regex_escaped(self):
        self.verify("worker/a.c")
        self.assertIsNone(w._verified_finding(self.root, "abc"))
        self.assertEqual(w._verified_finding(self.root, "a.c"), "V1")


class StatusRowTest(Repo):
    def test_row_fields_for_clean_ahead_dirty_and_orphan(self):
        w.cmd_add(self.root, "alice")
        self.commit_in("alice")
        self.verify("worker/alice")
        row = w._row(self.root, "worker/alice")
        self.assertEqual(
            row,
            {
                "agent": "alice",
                "branch": "worker/alice",
                "worktree": str(self.root / ".atlas" / "wt" / "alice"),
                "head": sh(self.root, "git", "rev-parse", "--short", "worker/alice"),
                "ahead": 1,
                "behind": 0,
                "dirty": False,
                "verified_finding": "V1",
                "merged": False,
            },
        )
        (self.root / ".atlas" / "wt" / "alice" / "scratch.txt").write_text("x")
        self.assertTrue(w._row(self.root, "worker/alice")["dirty"])
        sh(self.root, "git", "branch", "worker/orphan")
        orphan = w._row(self.root, "worker/orphan")
        self.assertEqual((orphan["worktree"], orphan["ahead"], orphan["merged"], orphan["dirty"]), (None, 0, True, False))

    def test_behind_counts_main_commits(self):
        sh(self.root, "git", "branch", "worker/old")
        (self.root / "n.txt").write_text("n")
        sh(self.root, "git", "add", "n.txt")
        sh(self.root, "git", "commit", "-qm", "main moves")
        row = w._row(self.root, "worker/old")
        self.assertEqual((row["behind"], row["ahead"]), (1, 0))

    def test_cmd_status_lists_only_worker_branches_sorted_by_ref(self):
        self.assertEqual(w.cmd_status(self.root), [])
        sh(self.root, "git", "branch", "feature/x")
        sh(self.root, "git", "branch", "worker/b")
        sh(self.root, "git", "branch", "worker/a")
        self.assertEqual(sorted(r["agent"] for r in w.cmd_status(self.root)), ["a", "b"])


class CmdMergeTest(Repo):
    def test_unknown_branch(self):
        with self.assertRaises(w.WtError) as cm:
            w.cmd_merge(self.root, "nobody")
        self.assertEqual(str(cm.exception), "no branch worker/nobody (nothing to merge)")

    def test_unverified_refusal_names_branch_and_path(self):
        w.cmd_add(self.root, "alice")
        self.commit_in("alice")
        with self.assertRaises(w.WtError) as cm:
            w.cmd_merge(self.root, "alice")
        msg = str(cm.exception)
        self.assertIn("refusing to merge worker/alice: no verified finding in", msg)
        self.assertIn("/".join(w.RELPATH), msg)

    def test_dirty_and_nothing_ahead_refusals(self):
        w.cmd_add(self.root, "alice")
        self.verify("worker/alice")
        with self.assertRaises(w.WtError) as cm:
            w.cmd_merge(self.root, "alice")
        self.assertIn("no commits ahead of HEAD", str(cm.exception))
        self.commit_in("alice")
        (self.root / ".atlas" / "wt" / "alice" / "dirt").write_text("x")
        with self.assertRaises(w.WtError) as cm:
            w.cmd_merge(self.root, "alice")
        self.assertIn("has uncommitted changes", str(cm.exception))

    def test_success_merges_no_ff_removes_worktree_and_branch(self):
        w.cmd_add(self.root, "alice")
        self.commit_in("alice")
        self.verify("worker/alice", fid="F7")
        out = w.cmd_merge(self.root, "alice")
        self.assertEqual(out["finding"], "F7")
        self.assertEqual(out["merge_commit"], sh(self.root, "git", "rev-parse", "HEAD"))
        self.assertEqual(sh(self.root, "git", "log", "-1", "--format=%s"), "Merge worker/alice (verified F7)")
        self.assertEqual(len(sh(self.root, "git", "log", "-1", "--format=%P").split()), 2)
        self.assertTrue((self.root / "w.txt").exists())
        self.assertFalse((self.root / ".atlas" / "wt" / "alice").exists())
        self.assertEqual(sh(self.root, "git", "branch", "--list", "worker/*"), "")

    def test_branch_without_worktree_merges_too(self):
        w.cmd_add(self.root, "alice")
        self.commit_in("alice")
        sh(self.root, "git", "worktree", "remove", "--force", str(self.root / ".atlas" / "wt" / "alice"))
        self.verify("worker/alice")
        out = w.cmd_merge(self.root, "alice")
        self.assertEqual(out["branch"], "worker/alice")
        self.assertEqual(sh(self.root, "git", "branch", "--list", "worker/*"), "")

    def test_conflict_is_aborted_and_main_tree_restored(self):
        w.cmd_add(self.root, "alice")
        self.commit_in("alice", name="a.txt", text="worker side\n")
        (self.root / "a.txt").write_text("main side\n")
        sh(self.root, "git", "commit", "-qam", "main edit")
        head = sh(self.root, "git", "rev-parse", "HEAD")
        self.verify("worker/alice")
        with self.assertRaises(w.WtError) as cm:
            w.cmd_merge(self.root, "alice")
        self.assertIn("merge of worker/alice failed and was aborted, main tree restored", str(cm.exception))
        self.assertEqual(sh(self.root, "git", "rev-parse", "HEAD"), head)
        self.assertEqual(sh(self.root, "git", "status", "--porcelain"), "")
        self.assertEqual((self.root / "a.txt").read_text(), "main side\n")
        self.assertEqual(sh(self.root, "git", "branch", "--list", "worker/alice").strip("+* "), "worker/alice")


class CmdPruneTest(Repo):
    def test_merged_orphan_pruned_unmerged_orphan_kept(self):
        sh(self.root, "git", "branch", "worker/zed")
        sh(self.root, "git", "checkout", "-q", "-b", "side")
        (self.root / "s.txt").write_text("s")
        sh(self.root, "git", "add", "s.txt")
        sh(self.root, "git", "commit", "-qm", "side")
        sh(self.root, "git", "checkout", "-q", "main")
        sh(self.root, "git", "branch", "worker/ahead", "side")
        out = w.cmd_prune(self.root)
        self.assertEqual(out["pruned_branches"], ["worker/zed"])
        self.assertEqual(sh(self.root, "git", "branch", "--list", "worker/*").strip(), "worker/ahead")

    def test_live_worktree_branch_not_pruned(self):
        w.cmd_add(self.root, "alice")
        out = w.cmd_prune(self.root)
        self.assertEqual(out["pruned_branches"], [])
        self.assertTrue((self.root / ".atlas" / "wt" / "alice").is_dir())

    def test_stale_worktree_metadata_pruned_first(self):
        w.cmd_add(self.root, "alice")
        import shutil

        shutil.rmtree(self.root / ".atlas" / "wt" / "alice")
        out = w.cmd_prune(self.root)
        self.assertEqual(out["pruned_branches"], ["worker/alice"])
        self.assertNotIn("alice", sh(self.root, "git", "worktree", "list"))

    def test_clean_results_are_merged_into_output(self):
        res = {"worktrees_removed": ["/w/x"], "branches_deleted": ["worker/x"], "errors": ["boom"]}
        with mock.patch.object(w.atlas_git, "clean", return_value=res) as cl:
            out = w.cmd_prune(self.root)
        self.assertEqual(cl.call_args[0], (self.root,))
        self.assertEqual(out, {"pruned_branches": [], "worktrees_removed": ["/w/x"], "branches_deleted": ["worker/x"], "errors": ["boom"]})
        with mock.patch.object(w.atlas_git, "clean", return_value={}):
            self.assertEqual(w.cmd_prune(self.root), {"pruned_branches": [], "worktrees_removed": [], "branches_deleted": []})

    def test_clean_failure_is_reported_not_raised_and_policy_module_optional(self):
        with mock.patch.object(w.atlas_git, "clean", side_effect=RuntimeError("e" * 500)):
            out = w.cmd_prune(self.root)
        self.assertEqual(out["clean_error"], "e" * 200)
        with mock.patch.object(w, "atlas_git", None):
            self.assertEqual(w.cmd_prune(self.root), {"pruned_branches": []})


class MainCliTest(Repo):
    def run_main(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = w.main(["--root", str(self.root), *argv])
        return rc, out.getvalue(), err.getvalue()

    def test_add_status_merge_prune_round_trip(self):
        rc, out, _ = self.run_main("add", "alice", "--base", "main")
        self.assertEqual((rc, json.loads(out)["created"]), (0, True))
        rc, out, _ = self.run_main("status")
        self.assertEqual([r["agent"] for r in json.loads(out)], ["alice"])
        self.commit_in("alice")
        self.verify("worker/alice")
        rc, out, _ = self.run_main("merge", "alice")
        self.assertEqual((rc, json.loads(out)["finding"]), (0, "V1"))
        rc, out, _ = self.run_main("prune")
        self.assertEqual((rc, json.loads(out)["pruned_branches"]), (0, []))

    def test_refusal_prints_reason_to_stderr_and_returns_one(self):
        rc, out, err = self.run_main("merge", "ghost")
        self.assertEqual((rc, out), (1, ""))
        self.assertEqual(err.strip(), "atlas_wt: no branch worker/ghost (nothing to merge)")

    def test_not_a_repo_returns_one(self):
        with tempfile.TemporaryDirectory() as td:
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                rc = w.main(["--root", td, "status"])
        self.assertEqual(rc, 1)
        self.assertIn("not inside a git repository", err.getvalue())

    def test_default_root_is_cwd_and_subcommand_required(self):
        cwd = os.getcwd()
        self.addCleanup(os.chdir, cwd)
        os.chdir(self.root)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(w.main(["status"]), 0)
        self.assertEqual(json.loads(out.getvalue()), [])
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                w.main([])


class ModuleImportTest(unittest.TestCase):
    def test_scripts_dir_goes_first_on_sys_path(self):
        path = SCRIPTS / "atlas_wt.py"
        fake = ["/first", "/second"]
        with mock.patch.object(sys, "path", fake):
            exec(compile(path.read_text(), str(path), "exec"), {"__name__": "atlas_wt_pathprobe", "__file__": str(path)})
            head = list(sys.path[:2])
        self.assertEqual(head[0], str(SCRIPTS))
        self.assertEqual(head[1], "/first")


if __name__ == "__main__":
    unittest.main()
