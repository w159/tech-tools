"""git_guard.py: the PreToolUse verdicts for protected branches, branch/worktree caps and PR creation.

Verdicts are asserted in-process through git_guard.verdict(); one subprocess test pins the hook's stdout
shape and one runs the whole thing through event_dispatch.py. Repos are throwaway (`git init -b main`).
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
SCRIPTS = PLUGIN / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(HERE))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import bash_advisor  # noqa: E402
import git_guard as gg  # noqa: E402

GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}
ATLAS_GIT = str(SCRIPTS / "atlas_git.py")


def sh(cwd, *args):
    return subprocess.run(
        list(args),
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=True,
        env=dict(os.environ, **GIT_ENV),
    ).stdout.strip()


def commit(cwd, name):
    (Path(cwd) / name).write_text(name + "\n")
    sh(cwd, "git", "add", name)
    sh(cwd, "git", "commit", "-qm", name)


def make_repo(other_branch=True):
    """Repo on main with a bare origin; optionally an active feat/x branch with its own commit."""
    base = Path(tempfile.mkdtemp()).resolve()
    repo = base / "repo"
    repo.mkdir()
    sh(repo, "git", "init", "-q", "-b", "main")
    commit(repo, "a.txt")
    sh(base, "git", "init", "-q", "--bare", "-b", "main", "origin.git")
    sh(repo, "git", "remote", "add", "origin", str(base / "origin.git"))
    sh(repo, "git", "push", "-q", "-u", "origin", "main")
    sh(repo, "git", "remote", "set-head", "origin", "main")
    if other_branch:
        sh(repo, "git", "switch", "-q", "-c", "feat/x")
        commit(repo, "x.txt")
        sh(repo, "git", "switch", "-q", "main")
    return repo


def bash(cmd, cwd):
    return {
        "hook_event_name": "PreToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": cmd},
        "cwd": str(cwd),
    }


class GuardBase(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(
            os.environ, {"ATLAS_HOME": tempfile.mkdtemp(), **GIT_ENV}
        )
        self.env.start()
        for k in list(os.environ):
            if k.startswith("ATLAS_GIT_"):
                del os.environ[k]
        self.addCleanup(self.env.stop)

    def kind(self, payload):
        v = gg.verdict(payload)
        return v["decision"] if v else None

    def reason(self, payload):
        v = gg.verdict(payload)
        return v["reason"] if v else ""


class ProtectedBranchTests(GuardBase):
    def test_commit_on_main_denied_with_another_branch_present(self):
        repo = make_repo()
        p = bash('git commit -m "x"', repo)
        self.assertEqual(self.kind(p), "deny")
        self.assertIn("feat/x", self.reason(p))
        self.assertIn("atlas_git.py", self.reason(p))

    def test_commit_on_main_asks_when_it_is_the_only_branch(self):
        repo = make_repo(other_branch=False)
        self.assertEqual(self.kind(bash("git commit -am x", repo)), "ask")

    def test_commit_on_a_feature_branch_is_fine(self):
        repo = make_repo()
        sh(repo, "git", "switch", "-q", "feat/x")
        self.assertIsNone(self.kind(bash("git commit -am x", repo)))

    def test_commit_variants(self):
        repo = make_repo()
        outside = tempfile.mkdtemp()
        cases = {
            "git -C %s commit -m x" % repo: outside,
            'sh -c "git commit -m x"': repo,
            "cd /tmp && git commit -m x": repo,  # cd is not tracked: the hook's cwd decides
            "git add -A && git commit -m x": repo,
            "git merge feat/x": repo,
            "git cherry-pick abc": repo,
        }
        for cmd, cwd in cases.items():
            with self.subTest(cmd=cmd):
                self.assertEqual(self.kind(bash(cmd, cwd)), "deny")

    def test_commit_control_flags_are_not_commits(self):
        repo = make_repo()
        for cmd in (
            "git merge --abort",
            "git cherry-pick --quit",
            "git commit --dry-run",
        ):
            with self.subTest(cmd=cmd):
                self.assertIsNone(self.kind(bash(cmd, repo)))

    def test_push_to_main_variants_denied(self):
        repo = make_repo()
        sh(repo, "git", "switch", "-q", "feat/x")
        for cmd in (
            "git push origin main",
            "git push origin HEAD:main",
            "git push origin HEAD:refs/heads/main",
            "git push origin feat/x:main",
            "git push origin +feat/x:production",
        ):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.kind(bash(cmd, repo)), "deny")

    def test_bare_push_on_main_is_a_push_to_main(self):
        repo = make_repo()
        self.assertEqual(self.kind(bash("git push", repo)), "deny")
        self.assertEqual(self.kind(bash("git push origin", repo)), "deny")

    def test_push_feature_branch_allowed(self):
        repo = make_repo()
        sh(repo, "git", "switch", "-q", "feat/x")
        for cmd in (
            "git push origin feat/x",
            "git push -u origin feat/x",
            "git push",
            "git push origin HEAD",
        ):
            with self.subTest(cmd=cmd):
                self.assertIsNone(self.kind(bash(cmd, repo)))

    def test_force_push_and_delete_of_protected_always_denied(self):
        repo = make_repo(other_branch=False)  # no other work: a plain push would only ask
        self.assertEqual(self.kind(bash("git push origin main", repo)), "ask")
        for cmd, word in (
            ("git push -f origin main", "force push"),
            ("git push --force-with-lease origin main", "force push"),
            ("git push origin +main", "force push"),
            ("git push --delete origin main", "delete"),
            ("git push -d origin main", "delete"),
        ):
            with self.subTest(cmd=cmd):
                v = gg.verdict(bash(cmd, repo))
                self.assertEqual(v["decision"], "deny")
                self.assertIn(word, v["reason"])

    def test_force_push_of_a_feature_branch_is_not_this_guards_business(self):
        repo = make_repo()
        sh(repo, "git", "switch", "-q", "feat/x")
        self.assertIsNone(self.kind(bash("git push -f origin feat/x", repo)))

    def test_grant_lets_a_push_through(self):
        repo = make_repo()
        self.assertEqual(self.kind(bash("git push origin main", repo)), "deny")
        import atlas_git

        atlas_git.add_grant(repo, "main", 5, "user asked")
        self.assertIsNone(self.kind(bash("git push origin main", repo)))
        # a force push is never granted
        self.assertEqual(self.kind(bash("git push -f origin main", repo)), "deny")

    def test_allow_command_is_a_permission_prompt(self):
        repo = make_repo()
        p = bash('python3 %s allow main --reason "user said so"' % ATLAS_GIT, repo)
        self.assertEqual(self.kind(p), "ask")
        self.assertIn("'main'", self.reason(p))

    def test_mcp_api_writes_on_protected_branch(self):
        repo = make_repo()
        for tool in (
            "mcp__github__push_files",
            "mcp__github__create_or_update_file",
            "mcp__github__delete_file",
        ):
            with self.subTest(tool=tool):
                p = {
                    "tool_name": tool,
                    "tool_input": {"branch": "main"},
                    "cwd": str(repo),
                }
                self.assertEqual(self.kind(p), "deny")
        p = {
            "tool_name": "mcp__github__push_files",
            "tool_input": {"branch": "feat/x"},
            "cwd": str(repo),
        }
        self.assertIsNone(self.kind(p))


class CapTests(GuardBase):
    def test_new_branch_over_cap_denied_under_cap_allowed(self):
        repo = make_repo()
        sh(
            repo, "git", "switch", "-q", "feat/x"
        )  # one unprotected branch with unmerged work
        with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_BRANCHES": "1"}):
            for cmd in (
                "git checkout -b feat/y",
                "git switch -c feat/y",
                "git branch feat/y",
            ):
                with self.subTest(cmd=cmd):
                    p = bash(cmd, repo)
                    self.assertEqual(self.kind(p), "deny")
                    self.assertIn("cap 1", self.reason(p))
                    self.assertIn("max_branches", self.reason(p))
        with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_BRANCHES": "5"}):
            for cmd in (
                "git checkout -b feat/y",
                "git switch -c feat/y",
                "git branch feat/y",
            ):
                with self.subTest(cmd=cmd):
                    self.assertIsNone(self.kind(bash(cmd, repo)))

    def test_branch_queries_and_plain_checkouts_are_not_creations(self):
        repo = make_repo()
        with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_BRANCHES": "1"}):
            for cmd in (
                "git branch",
                "git branch -a",
                "git branch -d feat/x",
                "git branch --show-current",
                "git checkout feat/x",
                "git switch feat/x",
                "git checkout -- a.txt",
            ):
                with self.subTest(cmd=cmd):
                    self.assertIsNone(self.kind(bash(cmd, repo)))

    def test_worktree_add_over_cap_denied(self):
        repo = make_repo()
        wt = repo.parent / "wt1"
        sh(repo, "git", "worktree", "add", "-q", str(wt), "-b", "feat/w")
        commit(wt, "w.txt")  # unmerged work: a clean cannot reclaim it
        with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_WORKTREES": "1"}):
            p = bash("git worktree add ../wt2 -b feat/w2", repo)
            self.assertEqual(self.kind(p), "deny")
            self.assertIn("linked worktrees", self.reason(p))
            self.assertIn("max_worktrees", self.reason(p))
            self.assertEqual(
                self.kind(bash("git worktree add ../wt3 feat/w", repo)), "deny"
            )
            self.assertIsNone(self.kind(bash("git worktree list", repo)))
        with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_WORKTREES": "3"}):
            self.assertIsNone(
                self.kind(bash("git worktree add ../wt2 -b feat/w2", repo))
            )

    def test_agent_with_worktree_isolation_over_cap_denied(self):
        repo = make_repo()
        wt = repo.parent / "wt1"
        sh(repo, "git", "worktree", "add", "-q", str(wt), "-b", "feat/w")
        commit(wt, "w.txt")
        for tool in ("Agent", "Task"):
            p = {
                "tool_name": tool,
                "tool_input": {"isolation": "worktree", "prompt": "x"},
                "cwd": str(repo),
            }
            with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_WORKTREES": "1"}):
                self.assertEqual(self.kind(p), "deny", tool)
            with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_WORKTREES": "4"}):
                self.assertIsNone(self.kind(p), tool)
        plain = {"tool_name": "Agent", "tool_input": {"prompt": "x"}, "cwd": str(repo)}
        with mock.patch.dict(os.environ, {"ATLAS_GIT_MAX_WORKTREES": "1"}):
            self.assertIsNone(self.kind(plain))


class PullRequestTests(GuardBase):
    def test_gh_pr_create_follows_the_prs_policy(self):
        repo = make_repo()
        p = bash("gh pr create --title t --body b", repo)
        self.assertEqual(self.kind(p), "ask")
        with mock.patch.dict(os.environ, {"ATLAS_GIT_PRS": "off"}):
            self.assertEqual(self.kind(p), "deny")
        with mock.patch.dict(os.environ, {"ATLAS_GIT_PRS": "allow"}):
            self.assertIsNone(self.kind(p))

    def test_other_pr_entry_points(self):
        repo = make_repo()
        payloads = [
            bash(
                "gh api -X POST repos/o/r/pulls -f title=t -f head=a -f base=main", repo
            ),
            bash("gh api --method POST /repos/o/r/pulls -F title=t", repo),
            bash("gh api repos/o/r/pulls -f title=t", repo),
            bash("hub pull-request -m t", repo),
            bash("gh pr new", repo),
            bash('sh -c "gh pr create --fill"', repo),
            {
                "tool_name": "mcp__github__create_pull_request",
                "tool_input": {"title": "t"},
                "cwd": str(repo),
            },
            {
                "tool_name": "mcp__plugin_github_github__create_pull_request",
                "tool_input": {},
                "cwd": str(repo),
            },
            {
                "tool_name": "Write",
                "tool_input": {
                    "file_path": "xd://github",
                    "content": json.dumps({"op": "pr_create"}),
                },
                "cwd": str(repo),
            },
        ]
        for p in payloads:
            with self.subTest(p=p.get("tool_input")):
                self.assertEqual(self.kind(p), "ask")
                self.assertIn("pull request", self.reason(p))
                with mock.patch.dict(os.environ, {"ATLAS_GIT_PRS": "off"}):
                    self.assertEqual(self.kind(p), "deny")

    def test_pr_reads_and_other_xd_ops_are_untouched(self):
        repo = make_repo()
        for p in (
            bash("gh pr list", repo),
            bash("gh pr view 3", repo),
            bash("gh pr merge 3", repo),
            bash("gh api repos/o/r/pulls", repo),  # a GET
            bash("gh api -X GET repos/o/r/pulls", repo),
            bash("gh issue create -t x", repo),
            {
                "tool_name": "mcp__github__list_pull_requests",
                "tool_input": {},
                "cwd": str(repo),
            },
            {
                "tool_name": "mcp__github__pull_request_read",
                "tool_input": {},
                "cwd": str(repo),
            },
            {
                "tool_name": "Write",
                "tool_input": {
                    "file_path": "xd://github",
                    "content": '{"op":"issue_create"}',
                },
                "cwd": str(repo),
            },
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "xd://github", "content": "not json"},
                "cwd": str(repo),
            },
        ):
            with self.subTest(p=p.get("tool_input")):
                self.assertIsNone(self.kind(p))

    def test_pr_outside_a_repo_still_follows_policy(self):
        p = bash("gh pr create --fill", tempfile.mkdtemp())
        self.assertEqual(self.kind(p), "ask")


class NoOpTests(GuardBase):
    def test_plain_git_and_unrelated_commands_pass(self):
        repo = make_repo()
        for cmd in (
            "git status",
            "git log --oneline -5",
            "git diff",
            "git add -A",
            "git fetch origin",
            "git stash",
            "ls -la",
            "echo git commit",  # not a git invocation
            "grep -r 'git push origin main' docs/",
        ):
            with self.subTest(cmd=cmd):
                self.assertIsNone(self.kind(bash(cmd, repo)))

    def test_non_git_cwd_passes(self):
        plain = tempfile.mkdtemp()
        for cmd in (
            "git commit -m x",
            "git push origin main",
            "git checkout -b x",
            "git worktree add ../w",
        ):
            with self.subTest(cmd=cmd):
                self.assertIsNone(self.kind(bash(cmd, plain)))

    def test_kill_switch(self):
        repo = make_repo()
        for off in ("off", "0", "false", "OFF"):
            with (
                self.subTest(off=off),
                mock.patch.dict(os.environ, {"ATLAS_GIT_GUARD": off}),
            ):
                self.assertIsNone(self.kind(bash("git commit -m x", repo)))
                self.assertIsNone(self.kind(bash("gh pr create", repo)))

    def test_on_protected_allow_policy_lets_everything_but_pr_through(self):
        repo = make_repo()
        with mock.patch.dict(os.environ, {"ATLAS_GIT_ON_PROTECTED": "allow"}):
            self.assertIsNone(self.kind(bash("git commit -m x", repo)))
            self.assertIsNone(self.kind(bash("git push -f origin main", repo)))

    def test_malformed_payloads_pass(self):
        for p in (
            {},
            {"tool_name": "Bash"},
            {"tool_name": "Bash", "tool_input": "git commit"},
            {"tool_name": "Bash", "tool_input": {"command": None}},
            {"tool_name": "Write", "tool_input": {"file_path": None}},
            {"tool_name": "Agent", "tool_input": []},
        ):
            with self.subTest(p=p):
                self.assertIsNone(self.kind(p))

    def test_policy_file_changes_the_verdict(self):
        repo = make_repo()
        (repo / ".atlas").mkdir()
        (repo / ".atlas" / "git-policy.json").write_text(
            json.dumps({"on_protected": "ask", "prs": "off"})
        )
        self.assertEqual(self.kind(bash("git commit -m x", repo)), "ask")
        self.assertEqual(self.kind(bash("gh pr create", repo)), "deny")


class ParserTests(unittest.TestCase):
    def test_push_targets(self):
        t = gg._push_targets
        self.assertEqual(t(["origin", "main"], "feat", None)[0], ["main"])
        self.assertEqual(t(["origin", "HEAD:main"], "feat", None)[0], ["main"])
        self.assertEqual(t(["origin", "HEAD"], "feat", None)[0], ["feat"])
        self.assertEqual(t([], "feat", "up"), (["up"], False, False, False))
        self.assertEqual(
            t(["-f", "origin", "a", "b"], "x", None), (["a", "b"], True, False, False)
        )
        self.assertEqual(t(["origin", "+a"], "x", None)[1], True)
        self.assertEqual(t(["--delete", "origin", "a"], "x", None)[2], True)
        self.assertEqual(t(["--all"], "x", None)[3], True)
        self.assertEqual(t(["-o", "ci.skip", "origin", "a"], "x", None)[0], ["a"])
        self.assertEqual(t(["origin", "v1:refs/tags/v1"], "x", None)[0], [])

    def test_new_branch(self):
        n = gg._new_branch
        self.assertEqual(n(["checkout", "-b", "a", "main"]), "a")
        self.assertEqual(n(["switch", "-c", "a"]), "a")
        self.assertEqual(n(["switch", "--create=a"]), "a")
        self.assertEqual(n(["branch", "a", "main"]), "a")
        self.assertEqual(n(["worktree", "add", "-b", "a", "../w"]), "a")
        self.assertIsNone(n(["branch", "-D", "a"]))
        self.assertIsNone(n(["checkout", "a"]))
        self.assertIsNone(n(["worktree", "list"]))


class BashAdvisorRegressionTests(unittest.TestCase):
    """_git_subcommands is now a thin wrapper over _git_invocations and must yield what it always did."""

    CASES = {
        "git status": ["status"],
        "git -C /x commit -m y": ["commit"],
        "git -c user.name=a commit -m y": ["commit"],
        "cd /x && git add -A && git commit -m y": ["add", "commit"],
        "git --no-pager log | head": ["log"],
        "sudo git push origin main": ["push"],
        "/usr/bin/git diff": ["diff"],
        'sh -c "git commit -m x"': ["commit"],
        "bash -lc 'git push origin main'": ["push"],
        "eval 'git reset --hard'": ["reset"],
        "echo hi": [],
        "echo $(git rev-parse HEAD)": ["rev-parse"],
        "git": [],
        "git -C": [],
        "": [],
    }

    def test_subcommands_unchanged(self):
        for cmd, want in self.CASES.items():
            with self.subTest(cmd=cmd):
                self.assertEqual(list(bash_advisor._git_subcommands(cmd)), want)

    def test_invocations_carry_argv_and_chdir(self):
        inv = list(bash_advisor._git_invocations("git -C /a -C sub push origin main"))
        self.assertEqual(inv, [(["push", "origin", "main"], "/a/sub")])
        self.assertEqual(
            list(bash_advisor._git_invocations("git status")), [(["status"], None)]
        )
        self.assertEqual(
            [a for a, _ in bash_advisor._git_invocations('sh -c "git commit -m x"')],
            [["commit", "-m", "x"]],
        )

    def test_program_invocations(self):
        got = list(
            bash_advisor._program_invocations(
                "sudo gh pr create --fill && ls", ("gh", "hub")
            )
        )
        self.assertEqual(got, [["gh", "pr", "create", "--fill"]])
        self.assertEqual(
            list(bash_advisor._program_invocations("echo gh", ("gh",))), []
        )


class HookProcessTests(GuardBase):
    def _run(self, argv, payload):
        return subprocess.run(
            argv,
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=dict(os.environ),
        )

    def test_hook_prints_a_pretooluse_decision(self):
        repo = make_repo()
        r = self._run(
            [sys.executable, str(HERE / "git_guard.py")], bash("git commit -m x", repo)
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        spec = json.loads(r.stdout)["hookSpecificOutput"]
        self.assertEqual(
            (spec["hookEventName"], spec["permissionDecision"]), ("PreToolUse", "deny")
        )
        self.assertIn("atlas git policy", spec["permissionDecisionReason"])

    def test_hook_is_silent_when_nothing_to_say(self):
        repo = make_repo()
        r = self._run(
            [sys.executable, str(HERE / "git_guard.py")], bash("git status", repo)
        )
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        r = self._run(
            [sys.executable, str(HERE / "git_guard.py")],
            {**bash("git commit", repo), "hook_event_name": "PostToolUse"},
        )
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_dispatcher_runs_the_guard(self):
        repo = make_repo()
        r = self._run(
            [sys.executable, "-S", str(HERE / "event_dispatch.py"), "PreToolUse"],
            bash("git push origin main", repo),
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(
            json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"], "deny"
        )
        for tool in ("mcp__github__create_pull_request",):
            r = self._run(
                [sys.executable, "-S", str(HERE / "event_dispatch.py"), "PreToolUse"],
                {
                    "hook_event_name": "PreToolUse",
                    "tool_name": tool,
                    "tool_input": {},
                    "cwd": str(repo),
                },
            )
            self.assertEqual(
                json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"], "ask"
            )


if __name__ == "__main__":
    unittest.main()
