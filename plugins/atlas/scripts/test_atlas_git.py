"""atlas_git.py: policy layering, protected detection, merged detection, clean, ensure_branch, check_action, grants.

Every test runs against throwaway git repos (`git init -b main`) with a local bare repo as origin.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_git as g  # noqa: E402

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}


def sh(cwd, *args):
    return subprocess.run(
        list(args),
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=True,
        env=dict(os.environ, **GIT_ENV),
    ).stdout.strip()


def commit(cwd, name, msg=None):
    p = Path(cwd) / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text((msg or name) + "\n")
    sh(cwd, "git", "add", name)
    sh(cwd, "git", "commit", "-qm", msg or name)


def make_repo(origin=False):
    """(repo, origin_or_None) with one commit on main; origin is a bare repo with origin/HEAD set."""
    base = Path(tempfile.mkdtemp()).resolve()
    repo = base / "repo"
    repo.mkdir()
    sh(repo, "git", "init", "-q", "-b", "main")
    commit(repo, "a.txt", "init")
    (repo / ".gitignore").write_text(".atlas/\n")
    sh(repo, "git", "add", ".gitignore")
    sh(repo, "git", "commit", "-qm", "ignore")
    bare = None
    if origin:
        bare = base / "origin.git"
        sh(base, "git", "init", "-q", "--bare", "-b", "main", str(bare))
        sh(repo, "git", "remote", "add", "origin", str(bare))
        sh(repo, "git", "push", "-q", "-u", "origin", "main")
        sh(repo, "git", "remote", "set-head", "origin", "main")
    return repo, bare


def branches(repo):
    return set(
        sh(
            repo, "git", "for-each-ref", "--format=%(refname:short)", "refs/heads"
        ).split()
    )


def remote_branches(bare):
    return set(
        sh(
            bare, "git", "for-each-ref", "--format=%(refname:short)", "refs/heads"
        ).split()
    )


class Base(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(
            os.environ, {"ATLAS_HOME": tempfile.mkdtemp(), **GIT_ENV}
        )
        self.env.start()
        for k in list(os.environ):
            if k.startswith("ATLAS_GIT_"):
                del os.environ[k]
        self.addCleanup(self.env.stop)


class PolicyTests(Base):
    def test_defaults(self):
        pol = g.load_policy(None)
        self.assertEqual(pol, g.DEFAULTS)
        self.assertIsNot(pol["protected"], g.DEFAULTS["protected"])

    def test_layers_user_then_project_then_env(self):
        repo, _ = make_repo()
        Path(os.environ["ATLAS_HOME"], "git-policy.json").write_text(
            json.dumps({"max_branches": 3, "prs": "off", "max_worktrees": 9})
        )
        self.assertEqual(g.load_policy(repo)["max_branches"], 3)
        (repo / ".atlas").mkdir()
        (repo / ".atlas" / "git-policy.json").write_text(
            json.dumps({"max_branches": 5, "prs": "allow"})
        )
        pol = g.load_policy(repo)
        self.assertEqual(
            (pol["max_branches"], pol["prs"], pol["max_worktrees"]), (5, "allow", 9)
        )
        with mock.patch.dict(
            os.environ, {"ATLAS_GIT_MAX_BRANCHES": "6", "ATLAS_GIT_PRS": "ask"}
        ):
            pol = g.load_policy(repo)
        self.assertEqual(
            (pol["max_branches"], pol["prs"], pol["max_worktrees"]), (6, "ask", 9)
        )

    def test_bad_values_keep_the_lower_layer(self):
        repo, _ = make_repo()
        (repo / ".atlas").mkdir()
        (repo / ".atlas" / "git-policy.json").write_text(
            json.dumps(
                {
                    "max_branches": 5,
                    "prs": "off",
                    "on_protected": "sometimes",
                    "nonsense": 1,
                }
            )
        )
        with mock.patch.dict(
            os.environ,
            {
                "ATLAS_GIT_MAX_BRANCHES": "lots",
                "ATLAS_GIT_PRS": "bogus",
                "ATLAS_GIT_ON_PROTECTED": "",
            },
        ):
            pol = g.load_policy(repo)
        self.assertEqual(pol["max_branches"], 5)
        self.assertEqual(pol["prs"], "off")
        self.assertEqual(
            pol["on_protected"], "auto"
        )  # project value invalid -> built-in default
        self.assertNotIn("nonsense", pol)

    def test_corrupt_policy_files_are_ignored(self):
        repo, _ = make_repo()
        Path(os.environ["ATLAS_HOME"], "git-policy.json").write_text("{not json")
        (repo / ".atlas").mkdir()
        (repo / ".atlas" / "git-policy.json").write_text("[1, 2]")
        self.assertEqual(g.load_policy(repo), g.DEFAULTS)

    def test_extra_lists_append(self):
        repo, _ = make_repo()
        (repo / ".atlas").mkdir()
        (repo / ".atlas" / "git-policy.json").write_text(
            json.dumps({"protected_extra": ["deploy/*"]})
        )
        pol = g.load_policy(repo)
        self.assertIn("deploy/*", pol["protected"])
        self.assertIn("main", pol["protected"])


class ProtectedTests(Base):
    def test_origin_head_default_branch_is_protected(self):
        repo, bare = make_repo(origin=True)
        sh(repo, "git", "branch", "develop")
        sh(repo, "git", "push", "-q", "origin", "develop")
        sh(bare, "git", "symbolic-ref", "HEAD", "refs/heads/develop")
        sh(repo, "git", "remote", "set-head", "origin", "-a")
        self.assertEqual(g.default_branch(repo), "develop")
        self.assertEqual(g.is_protected(repo, "develop"), "default branch")

    def test_patterns_and_unprotected(self):
        repo, _ = make_repo()
        self.assertTrue(g.is_protected(repo, "release/1.2"))
        self.assertTrue(g.is_protected(repo, "production"))
        self.assertIsNone(g.is_protected(repo, "feat/x"))
        self.assertIsNone(g.is_protected(repo, "atlas/fix"))
        self.assertIsNone(g.is_protected(repo, None))

    def test_cached_github_protection(self):
        repo, _ = make_repo()
        self.assertIsNone(g.is_protected(repo, "hotfix"))
        run = repo / ".atlas" / ".run"
        run.mkdir(parents=True)
        (run / g.CACHE_NAME).write_text(json.dumps({"github_protected": ["hotfix"]}))
        self.assertEqual(g.is_protected(repo, "hotfix"), "GitHub branch protection")


class MergedTests(Base):
    def test_fast_forward_squash_and_unmerged(self):
        repo, _ = make_repo()
        sh(repo, "git", "switch", "-q", "-c", "ff")
        commit(repo, "ff.txt")
        sh(repo, "git", "switch", "-q", "main")
        sh(repo, "git", "merge", "-q", "--ff-only", "ff")
        self.assertTrue(g.is_merged(repo, "ff", "main"))

        sh(repo, "git", "switch", "-q", "-c", "sq")
        commit(repo, "sq1.txt")
        commit(repo, "sq2.txt")
        sh(repo, "git", "switch", "-q", "main")
        sh(repo, "git", "merge", "-q", "--squash", "sq")
        sh(repo, "git", "commit", "-qm", "squash sq")
        commit(repo, "later.txt")  # main moved on after the squash
        self.assertTrue(g.is_merged(repo, "sq", "main"))

        sh(repo, "git", "switch", "-q", "-c", "open")
        commit(repo, "open.txt")
        sh(repo, "git", "switch", "-q", "main")
        self.assertFalse(g.is_merged(repo, "open", "main"))


class CleanTests(Base):
    def _wt(self, repo, name, work=False):
        path = repo.parent / ("wt-" + name.replace("/", "-"))
        sh(repo, "git", "worktree", "add", "-q", str(path), "-b", name)
        if work:
            commit(path, "w-%s.txt" % name.replace("/", "-"))
        return path

    def _policy(self, repo, **kw):
        pol = g.load_policy(repo)
        pol.update({"worktree_idle_minutes": 0}, **kw)
        return pol

    def test_clean_removes_merged_and_keeps_everything_else(self):
        repo, _ = make_repo()
        # merged branch + merged clean worktree
        sh(repo, "git", "branch", "atlas/merged")
        merged_wt = self._wt(repo, "worker/merged")
        # unmerged branch, unmerged worktree, dirty worktree, locked worktree
        sh(repo, "git", "switch", "-q", "-c", "atlas/unmerged")
        commit(repo, "u.txt")
        sh(repo, "git", "switch", "-q", "main")
        unmerged_wt = self._wt(repo, "worker/unmerged", work=True)
        dirty_wt = self._wt(repo, "worker/dirty")
        (dirty_wt / "scratch.txt").write_text("x")
        locked_wt = self._wt(repo, "worker/locked")
        sh(repo, "git", "worktree", "lock", str(locked_wt))

        out = g.clean(repo, self._policy(repo))
        self.assertTrue(out["ok"], out)
        self.assertFalse(merged_wt.exists())
        self.assertEqual(
            sorted(os.path.basename(p) for p in out["worktrees_removed"]),
            ["wt-worker-merged"],
        )
        for keep in (unmerged_wt, dirty_wt, locked_wt):
            self.assertTrue(keep.exists(), keep)
        left = branches(repo)
        self.assertNotIn("atlas/merged", left)
        self.assertNotIn("worker/merged", left)
        for must in (
            "main",
            "atlas/unmerged",
            "worker/unmerged",
            "worker/dirty",
            "worker/locked",
        ):
            self.assertIn(must, left)

    def test_clean_never_deletes_current_branch_even_when_merged(self):
        repo, _ = make_repo()
        sh(
            repo, "git", "switch", "-q", "-c", "atlas/here"
        )  # same commit as main: "merged"
        g.clean(repo, self._policy(repo))
        self.assertIn("atlas/here", branches(repo))
        self.assertEqual(g.current_branch(repo), "atlas/here")

    def test_recently_touched_worktree_is_kept(self):
        repo, _ = make_repo()
        wt = self._wt(repo, "worker/fresh")
        pol = g.load_policy(repo)  # default 120 idle minutes; just created
        out = g.clean(repo, pol)
        self.assertTrue(wt.exists())
        self.assertIn("worker/fresh", branches(repo))
        self.assertEqual(out["worktrees_removed"], [])

    def test_protected_branches_are_never_deleted(self):
        repo, _ = make_repo()
        for name in ("production", "release/1.0"):
            sh(repo, "git", "branch", name)
        g.clean(repo, self._policy(repo))
        self.assertTrue({"production", "release/1.0", "main"} <= branches(repo))

    def test_squash_merged_branch_is_deleted(self):
        repo, _ = make_repo()
        sh(repo, "git", "switch", "-q", "-c", "atlas/sq")
        commit(repo, "s.txt")
        sh(repo, "git", "switch", "-q", "main")
        sh(repo, "git", "merge", "-q", "--squash", "atlas/sq")
        sh(repo, "git", "commit", "-qm", "squash")
        out = g.clean(repo, self._policy(repo))
        self.assertIn("atlas/sq", out["branches_deleted"])
        self.assertNotIn("atlas/sq", branches(repo))

    def test_dry_run_changes_nothing_and_cleanup_off_skips(self):
        repo, _ = make_repo()
        sh(repo, "git", "branch", "atlas/merged")
        out = g.clean(repo, self._policy(repo), dry_run=True)
        self.assertEqual(
            [b["branch"] for b in out["plan"]["remove_branches"]], ["atlas/merged"]
        )
        self.assertIn("atlas/merged", branches(repo))
        off = g.clean(repo, self._policy(repo, cleanup_local="off"))
        self.assertIn("skipped", off)
        self.assertIn("atlas/merged", branches(repo))

    def test_dry_run_does_not_write_the_stamp(self):
        repo, _ = make_repo()
        g.clean(repo, self._policy(repo), dry_run=True)
        self.assertFalse((repo / ".atlas" / ".run" / "git-clean-stamp.json").exists())

    def test_clean_writes_the_stamp(self):
        repo, _ = make_repo()
        g.clean(repo, self._policy(repo))
        stamp = json.loads(
            (repo / ".atlas" / ".run" / "git-clean-stamp.json").read_text()
        )
        self.assertLess(abs(stamp["at"] - time.time()), 30)

    def test_remote_clean_only_agent_made_merged_branches(self):
        repo, bare = make_repo(origin=True)
        # agent-made + merged (prefix), agent-made via ledger + merged, human merged, agent-made unmerged
        for name in ("atlas/done", "feature/human-done", "custom-ledger"):
            sh(repo, "git", "branch", name)
        g.note_created(repo, "custom-ledger")
        sh(repo, "git", "switch", "-q", "-c", "atlas/open")
        commit(repo, "o.txt")
        sh(repo, "git", "switch", "-q", "main")
        sh(
            repo,
            "git",
            "push",
            "-q",
            "origin",
            "atlas/done",
            "feature/human-done",
            "custom-ledger",
            "atlas/open",
        )
        self.assertEqual(
            remote_branches(bare),
            {"main", "atlas/done", "feature/human-done", "custom-ledger", "atlas/open"},
        )
        out = g.clean(repo, self._policy(repo), remote=True)
        self.assertTrue(out["ok"], out)
        self.assertEqual(
            sorted(out["remote_deleted"]), ["origin/atlas/done", "origin/custom-ledger"]
        )
        self.assertEqual(
            remote_branches(bare), {"main", "feature/human-done", "atlas/open"}
        )

    def test_remote_clean_off_leaves_the_remote_alone(self):
        repo, bare = make_repo(origin=True)
        sh(repo, "git", "branch", "atlas/done")
        sh(repo, "git", "push", "-q", "origin", "atlas/done")
        out = g.clean(repo, self._policy(repo, cleanup_remote="off"), remote=True)
        self.assertEqual(out["remote_deleted"], [])
        self.assertIn("atlas/done", remote_branches(bare))
        # and without --remote the remote is never touched either
        g.clean(repo, self._policy(repo))
        self.assertIn("atlas/done", remote_branches(bare))


class EnsureBranchTests(Base):
    def test_creates_then_reuses(self):
        repo, _ = make_repo()
        first = g.ensure_branch(repo, "Fix the Thing!")
        self.assertEqual(
            (first["branch"], first["created"]), ("atlas/fix-the-thing", True)
        )
        self.assertEqual(g.current_branch(repo), "atlas/fix-the-thing")
        sh(repo, "git", "switch", "-q", "main")
        again = g.ensure_branch(repo, "Fix the Thing!")
        self.assertEqual(
            (again["branch"], again["created"]), ("atlas/fix-the-thing", False)
        )
        self.assertEqual(g.current_branch(repo), "atlas/fix-the-thing")
        self.assertEqual(len([b for b in branches(repo) if b.startswith("atlas/")]), 1)
        self.assertIn(
            "atlas/fix-the-thing",
            json.loads((repo / ".atlas/.run/git-ledger.json").read_text())["branches"],
        )

    def test_refuses_at_cap_but_reuse_still_works(self):
        repo, _ = make_repo()
        pol = g.load_policy(repo)
        pol["max_branches"] = 2
        for n in ("one", "two"):
            g.ensure_branch(repo, n, policy=pol)
            commit(repo, n + ".txt")  # real work, so a clean cannot reclaim the slot
        with self.assertRaises(g.GitError) as cm:
            g.ensure_branch(repo, "three", policy=pol)
        self.assertIn("cap 2", str(cm.exception))
        self.assertNotIn("atlas/three", branches(repo))
        self.assertEqual(g.ensure_branch(repo, "one", policy=pol)["created"], False)

    def test_cap_reclaims_merged_branches_first(self):
        repo, _ = make_repo()
        pol = g.load_policy(repo)
        pol["max_branches"] = 1
        sh(repo, "git", "branch", "atlas/old-merged")
        got = g.ensure_branch(repo, "new", policy=pol)
        self.assertTrue(got["created"])
        self.assertNotIn("atlas/old-merged", branches(repo))

    def test_protected_name_refused(self):
        repo, _ = make_repo()
        pol = dict(g.load_policy(repo), protected=["main", "atlas/locked"])
        with self.assertRaises(g.GitError):
            g.ensure_branch(repo, "locked", policy=pol)
        self.assertNotIn("atlas/locked", branches(repo))


class CheckActionTests(Base):
    def test_commit_on_protected_denied_when_another_branch_is_active(self):
        repo, _ = make_repo()
        sh(repo, "git", "switch", "-q", "-c", "feat/x")
        commit(repo, "x.txt")
        sh(repo, "git", "switch", "-q", "main")
        v = g.check_action(repo, "commit", branch="main")
        self.assertEqual(v["decision"], "deny", v)
        self.assertIn("feat/x", v["reason"])
        self.assertIn("allow main", v["reason"])

    def test_commit_on_protected_asks_when_it_is_the_only_line_of_work(self):
        repo, _ = make_repo()
        self.assertEqual(
            g.check_action(repo, "commit", branch="main")["decision"], "ask"
        )

    def test_old_branches_do_not_count_as_active(self):
        repo, _ = make_repo()
        sh(repo, "git", "switch", "-q", "-c", "feat/old")
        old = "%d +0000" % (time.time() - 90 * 86400)
        subprocess.run(
            ["git", "-C", str(repo), "commit", "-q", "--allow-empty", "-m", "old", "--date", old],
            env=dict(os.environ, **GIT_ENV, GIT_COMMITTER_DATE=old),
            check=True,
            capture_output=True,
        )
        sh(repo, "git", "switch", "-q", "main")
        self.assertEqual(g.active_other_branches(repo, exclude="main"), [])
        self.assertEqual(g.check_action(repo, "commit", branch="main")["decision"], "ask")

    def test_other_modes_and_unprotected_branches(self):
        repo, _ = make_repo()
        sh(repo, "git", "switch", "-q", "-c", "feat/x")
        commit(repo, "x.txt")
        sh(repo, "git", "switch", "-q", "main")
        for mode, want in (("deny", "deny"), ("ask", "ask"), ("allow", "allow")):
            pol = dict(g.load_policy(repo), on_protected=mode)
            self.assertEqual(
                g.check_action(repo, "push", target="main", policy=pol)["decision"],
                want,
                mode,
            )
        self.assertEqual(
            g.check_action(repo, "commit", branch="feat/x")["decision"], "allow"
        )
        self.assertEqual(
            g.check_action(repo, "commit", branch=None)["decision"], "allow"
        )  # detached HEAD

    def test_grant_allows_then_expires(self):
        repo, _ = make_repo()
        sh(repo, "git", "switch", "-q", "-c", "feat/x")
        commit(repo, "x.txt")
        sh(repo, "git", "switch", "-q", "main")
        self.assertEqual(
            g.check_action(repo, "push", target="main")["decision"], "deny"
        )
        now = time.time()
        grant = g.add_grant(repo, "main", 10, "user asked for a hotfix")
        self.assertEqual(
            g.check_action(repo, "push", target="main")["decision"], "allow"
        )
        self.assertEqual(
            g.check_action(repo, "commit", branch="main")["decision"], "allow"
        )
        self.assertEqual(
            g.check_action(repo, "push", target="production")["decision"], "deny"
        )  # the grant is for main only
        with mock.patch.object(g.time, "time", return_value=now + 11 * 60):
            self.assertIsNone(g.active_grant(repo, "main"))
            self.assertEqual(
                g.check_action(repo, "push", target="main")["decision"], "deny"
            )
        self.assertLessEqual(grant["until"] - now, 10 * 60 + 5)

    def test_grant_minutes_are_capped(self):
        repo, _ = make_repo()
        grant = g.add_grant(repo, "main", 100000, "x")
        self.assertLessEqual(grant["until"] - time.time(), 240 * 60 + 5)

    def test_pr_policy(self):
        repo, _ = make_repo()
        self.assertEqual(g.check_action(repo, "pr")["decision"], "ask")
        self.assertEqual(
            g.check_action(repo, "pr", policy=dict(g.load_policy(repo), prs="off"))[
                "decision"
            ],
            "deny",
        )
        self.assertEqual(
            g.check_action(repo, "pr", policy=dict(g.load_policy(repo), prs="allow"))[
                "decision"
            ],
            "allow",
        )

    def test_branch_and_worktree_caps(self):
        repo, _ = make_repo()
        pol = dict(g.load_policy(repo), max_branches=1, max_worktrees=1)
        self.assertEqual(
            g.check_action(repo, "branch", policy=pol)["decision"], "allow"
        )
        sh(repo, "git", "switch", "-q", "-c", "feat/a")
        commit(repo, "a2.txt")
        sh(repo, "git", "switch", "-q", "main")
        self.assertEqual(g.check_action(repo, "branch", policy=pol)["decision"], "deny")
        wt = repo.parent / "wt-a"
        sh(repo, "git", "worktree", "add", "-q", str(wt), "-b", "feat/b")
        commit(wt, "b.txt")
        self.assertEqual(
            g.check_action(repo, "worktree", policy=pol)["decision"], "deny"
        )
        self.assertEqual(
            g.check_action(repo, "worktree", policy=dict(pol, max_worktrees=0))[
                "decision"
            ],
            "allow",
        )  # 0 = unlimited

    def test_cli_exit_codes(self):
        repo, _ = make_repo()
        script = str(HERE / "atlas_git.py")
        run = lambda *a: subprocess.run(  # noqa: E731
            [sys.executable, script, "--root", str(repo), *a],
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            run("check", "commit", "--branch", "main").returncode, g.EXIT_ASK
        )
        self.assertEqual(run("check", "commit", "--branch", "feat/x").returncode, 0)
        self.assertEqual(run("allow", "main").returncode, 1)  # needs --reason
        self.assertEqual(run("allow", "main", "--reason", "user said so").returncode, 0)
        self.assertEqual(run("check", "commit", "--branch", "main").returncode, 0)
        self.assertEqual(run("policy").returncode, 0)


class WorktreeInventoryTests(Base):
    def test_missing_worktree_is_pruned_and_main_checkout_excluded(self):
        repo, _ = make_repo()
        wt = repo.parent / "gone"
        sh(repo, "git", "worktree", "add", "-q", str(wt), "-b", "worker/gone")
        self.assertEqual(
            [os.path.basename(w["path"]) for w in g.worktrees(repo)], ["gone"]
        )
        import shutil

        shutil.rmtree(wt)
        out = g.clean(repo, dict(g.load_policy(repo), worktree_idle_minutes=0))
        self.assertEqual(g.worktrees(repo), [])
        self.assertNotIn("worker/gone", branches(repo))  # branch had no commits: merged
        self.assertTrue(out["ok"], out)


def _enable_analytics():
    import atlas_analytics

    d = Path(os.environ["ATLAS_HOME"]) / "analytics"
    d.mkdir(parents=True, exist_ok=True)
    (d / "consent.json").write_text(json.dumps({"enabled": True, "decided": True}))
    atlas_analytics._reset()
    return atlas_analytics, d / "events.jsonl"


def _events(path):
    return (
        [(json.loads(ln)["k"], json.loads(ln)["n"]) for ln in path.read_text().splitlines()]
        if path.exists()
        else []
    )


class AnalyticsTests(Base):
    def setUp(self):
        super().setUp()
        import atlas_analytics

        self.addCleanup(atlas_analytics._reset)
        atlas_analytics._reset()

    def test_clean_records_counts_only_when_something_was_removed(self):
        _, ev = _enable_analytics()
        repo, bare = make_repo(origin=True)
        for name in ("atlas/a", "atlas/b"):
            sh(repo, "git", "branch", name)
        sh(repo, "git", "branch", "atlas/c")
        sh(repo, "git", "push", "-q", "origin", "atlas/c")
        g.clean(repo, dict(g.load_policy(repo)), dry_run=True)
        self.assertEqual([], _events(ev))  # dry run records nothing
        out = g.clean(repo, dict(g.load_policy(repo)), remote=True)
        self.assertTrue(out["ok"], out)
        self.assertEqual(
            [("git.clean.branches", 3), ("git.clean.remote", 1)], _events(ev)
        )

    def test_clean_with_nothing_to_remove_records_nothing(self):
        _, ev = _enable_analytics()
        repo, _ = make_repo()
        g.clean(repo, dict(g.load_policy(repo)))
        self.assertEqual([], _events(ev))

    def test_branch_created_then_reused(self):
        _, ev = _enable_analytics()
        repo, _ = make_repo()
        g.ensure_branch(repo, "work")
        g.ensure_branch(repo, "work")
        self.assertEqual(
            [("git.branch.created", 1), ("git.branch.reused", 1)], _events(ev)
        )

    def test_disabled_writes_nothing(self):
        import atlas_analytics

        atlas_analytics._reset()
        repo, _ = make_repo()
        sh(repo, "git", "branch", "atlas/a")
        g.ensure_branch(repo, "work")
        g.clean(repo, dict(g.load_policy(repo)))
        self.assertFalse((Path(os.environ["ATLAS_HOME"]) / "analytics").exists())


FAKE_GH = """#!%s
import os, sys
d = os.environ["FAKE_GH_DIR"]
open(os.path.join(d, "calls.log"), "a").write(" ".join(sys.argv[1:]) + "\\n")
mode = open(os.path.join(d, "mode")).read().strip()
if mode == "403":
    sys.stderr.write("HTTP 403: Resource not accessible\\n")
    sys.exit(1)
sys.stdout.write("main\\nlegacy-line\\n")
"""


class ProtectedRefreshTests(Base):
    def setUp(self):
        super().setUp()
        self.d = Path(tempfile.mkdtemp())
        gh = self.d / "gh"
        gh.write_text(FAKE_GH % sys.executable)
        gh.chmod(0o755)
        (self.d / "mode").write_text("ok")
        self.path = mock.patch.dict(
            os.environ,
            {"PATH": str(self.d) + os.pathsep + os.environ["PATH"], "FAKE_GH_DIR": str(self.d)},
        )
        self.path.start()
        self.addCleanup(self.path.stop)

    def _repo(self, url="https://github.com/acme/widgets.git"):
        repo, _ = make_repo()
        sh(repo, "git", "remote", "add", "origin", url)
        return repo

    def _cache(self, repo):
        return json.loads((repo / ".atlas/.run/git-cache.json").read_text())

    def test_refresh_stores_names_and_timestamp_only(self):
        repo = self._repo()
        self.assertEqual(0, g.main(["--root", str(repo), "protected", "--refresh"]))
        c = self._cache(repo)
        self.assertEqual(["legacy-line", "main"], c["github_protected"])
        self.assertEqual({"github_protected", "github_protected_at"}, set(c))
        call = (self.d / "calls.log").read_text()
        self.assertIn("repos/acme/widgets/branches", call)
        self.assertIn("protected=true", call)
        self.assertIn("--paginate", call)
        self.assertEqual("GitHub branch protection", g.is_protected(repo, "legacy-line"))

    def test_ssh_origin_is_parsed(self):
        repo = self._repo("git@github.com:acme/widgets.git")
        g.refresh_protected(repo)
        self.assertIn("repos/acme/widgets/", (self.d / "calls.log").read_text())

    def test_non_github_origin_never_calls_gh(self):
        repo = self._repo("https://gitlab.com/acme/widgets.git")
        self.assertIsNone(g.refresh_protected(repo))
        self.assertFalse((self.d / "calls.log").exists())

    def test_403_fails_open_and_keeps_the_old_cache(self):
        repo = self._repo()
        g.refresh_protected(repo)
        before = self._cache(repo)
        (self.d / "mode").write_text("403")
        self.assertEqual(0, g.main(["--root", str(repo), "protected", "--refresh"]))
        self.assertEqual(before, self._cache(repo))

    def test_gh_missing_fails_open(self):
        repo = self._repo()
        only_git = Path(tempfile.mkdtemp())
        (only_git / "git").symlink_to(shutil.which("git"))
        with mock.patch.dict(os.environ, {"PATH": str(only_git)}):
            self.assertIsNone(g.refresh_protected(repo))
        self.assertFalse((repo / ".atlas/.run/git-cache.json").exists())


if __name__ == "__main__":
    unittest.main()
