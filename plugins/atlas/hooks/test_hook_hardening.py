"""Regression tests for the core-hook hardening wave: bounded git parsing,
one shared git parser for bash_advisor and fallow_gate, one payload policy
(exit 0 + fault trace), visible Stop-breaker bypass, DB-unusable trace, and
hooks.json timeouts."""

import os as _iso_os
import sys as _iso_sys

_HERE = _iso_os.path.dirname(_iso_os.path.abspath(__file__))
_iso_sys.path.insert(0, _iso_os.path.join(_HERE, "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, _HERE)
import atlas_hook_guard  # noqa: E402
import bash_advisor  # noqa: E402
import fallow_gate  # noqa: E402

HOOKS_JSON = os.path.join(_HERE, "hooks.json")
CORE = [
    "bash_advisor",
    "fallow_gate",
    "format_after_edit",
    "todo_capture",
    "prompt_optimizer",
    "completion_gate",
]


def _run(hook, stdin, env_extra=None, timeout=60):
    home = tempfile.mkdtemp()
    env = {
        **os.environ,
        "ATLAS_HOME": home,
        "ATLAS_DB": os.path.join(home, "atlas.db"),
        "ATLAS_HOOKSTATE_DIR": os.path.join(home, "hookstate"),
        "ATLAS_DECISION": "off",
        "ATLAS_MANDATES": "off",
        "ATLAS_DASHBOARD": "off",
        "ATLAS_COLONY": "off",
        **(env_extra or {}),
    }
    r = subprocess.run(
        [sys.executable, os.path.join(_HERE, hook + ".py")],
        input=stdin,
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    fp = os.path.join(env["ATLAS_HOME"], "hook-faults.jsonl")
    faults = []
    if os.path.exists(fp):
        faults = [json.loads(x) for x in open(fp).read().splitlines() if x.strip()]
    return r, faults


class GitParserTests(unittest.TestCase):
    # (command, is commit, is commit-or-push)
    TABLE = [
        ("git commit -m x", True, True),
        ("git commit", True, True),
        ("git commit --amend", True, True),
        ("git  commit  -am msg", True, True),
        ("git -C . commit -m x", True, True),
        ("git -C /tmp/some/repo commit", True, True),
        ("git -c user.name=x commit -m x", True, True),
        ("git -c a=b -c c=d commit", True, True),
        ("git --git-dir=.git commit", True, True),
        ("git --work-tree=. commit -m x", True, True),
        ("git -- commit", True, True),
        ("FOO=1 git commit -m x", True, True),
        ("A=1 B=2 git commit", True, True),
        ("/usr/bin/git commit -m x", True, True),
        ("cd src && git commit -m x", True, True),
        ("git add -A && git commit -m x", True, True),
        ("git add . ; git commit -m x", True, True),
        ("make test || git commit -m wip", True, True),
        ("git status | cat; git commit", True, True),
        ("git push origin main", False, True),
        ("git -C x push", False, True),
        ("git commit -m x && git push", True, True),
        ("git status", False, False),
        ("git log --oneline", False, False),
        ("echo git commit", False, False),
        ("echo 'git commit'", False, False),
        ("git log --oneline | grep git commit", False, False),
        ("git commit-tree HEAD^{tree}", False, False),
        ("git stash commit", False, False),
        ("git-commit -m x", False, False),
        ("grep -r 'git push' docs/", False, False),
        ("ls", False, False),
        ("", False, False),
    ]

    def test_hooks_agree_on_every_form(self):
        self.assertGreaterEqual(len(self.TABLE), 25)
        for cmd, commit, gated in self.TABLE:
            with self.subTest(cmd=cmd):
                self.assertEqual(bash_advisor._match_git_commit(cmd), commit)
                self.assertEqual(fallow_gate._is_git_commit_or_push(cmd), gated)

    def test_fallow_denies_global_option_commit_end_to_end(self):
        shim = tempfile.mkdtemp()
        p = os.path.join(shim, "fallow")
        with open(p, "w") as f:
            f.write(
                "#!/bin/sh\n"
                'case "$1" in --version) echo "fallow 9.9.9";; '
                '*) echo \'{"verdict":"fail"}\'; exit 1;; esac\n'
            )
        os.chmod(p, 0o755)
        env = {"PATH": shim + os.pathsep + os.environ["PATH"]}
        for cmd, expect in (
            ("git -C . commit -m x", True),
            ("echo git commit", False),
        ):
            with self.subTest(cmd=cmd):
                payload = json.dumps(
                    {"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": shim}
                ).encode()
                r, _ = _run("fallow_gate", payload, env)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual("permissionDecision" in r.stdout.decode(), expect)


class BashAdvisorBoundTests(unittest.TestCase):
    def test_huge_single_token_is_fast(self):
        for n in (1_000_000, 3_000_000):
            cmd = "echo " + "A" * n
            t = time.perf_counter()
            self.assertFalse(bash_advisor._match_git_commit(cmd))
            self.assertIsNone(bash_advisor._match_catastrophic(cmd))
            self.assertLess(time.perf_counter() - t, 0.5, n)

    def test_many_segments_is_fast(self):
        cmd = "git status;" * 1_000_000
        t = time.perf_counter()
        bash_advisor._match_git_commit(cmd)
        self.assertLess(time.perf_counter() - t, 0.5)

    def test_commit_after_a_long_heredoc_head_still_found_when_short_segments(self):
        cmd = "echo hi && git commit -m x"
        self.assertTrue(bash_advisor._match_git_commit(cmd))

    def test_main_on_1m_command_under_budget(self):
        payload = json.dumps(
            {"tool_name": "Bash", "tool_input": {"command": "echo " + "A" * 1_000_000}}
        ).encode()
        t = time.perf_counter()
        r, faults = _run("bash_advisor", payload)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertLess(time.perf_counter() - t, 1.5)
        self.assertEqual(faults, [])


class CatastrophicTests(unittest.TestCase):
    FLAGGED = [
        "rm -rf /",
        "rm -rf /*",
        "rm -rf ~",
        "rm -rf ~/",
        "rm -rf ~/*",
        "rm -rf $HOME",
        "rm -rf $HOME/",
        'rm -rf "$HOME"',
        'rm -rf "$HOME/"',
        'rm -rf "${HOME}"',
        "rm -fr $HOME/",
        "rm --recursive --force ~/",
        "sudo rm -rf /",
        "cd / && rm -rf *",
        "cd /; rm -rf ./*",
        "find / -delete",
        "find ~ -delete",
        'find "$HOME" -maxdepth 3 -delete',
        "mkfs.ext4 /dev/sda1",
        "sudo mkfs -t ext4 /dev/sdb",
        "ls && mkfs.xfs /dev/nvme0n1",
        "/sbin/mkfs.ext4 /dev/sda1",
        "dd if=/dev/zero of=/dev/sda",
        ":(){ :|:& };:",
    ]
    CLEAN = [
        "echo mkfs",
        "grep mkfs docs/x",
        "cat docs/mkfs.md",
        "rm -rf build/",
        "rm -rf ./node_modules",
        "rm -rf ~/projects/x/build",
        "rm -rf $HOME/.cache/foo",
        "cd /tmp && rm -rf *",
        "find . -name '*.pyc' -delete",
        "find / -name '*.pyc' -delete",
        "ls /",
    ]

    def test_flagged(self):
        for cmd in self.FLAGGED:
            with self.subTest(cmd=cmd):
                self.assertIsNotNone(bash_advisor._match_catastrophic(cmd))

    def test_clean(self):
        for cmd in self.CLEAN:
            with self.subTest(cmd=cmd):
                self.assertIsNone(bash_advisor._match_catastrophic(cmd))


class PayloadPolicyTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self._old = os.environ.get("ATLAS_HOME")
        os.environ["ATLAS_HOME"] = self.home

    def tearDown(self):
        if self._old is None:
            os.environ.pop("ATLAS_HOME", None)
        else:
            os.environ["ATLAS_HOME"] = self._old

    def _faults(self):
        fp = os.path.join(self.home, "hook-faults.jsonl")
        if not os.path.exists(fp):
            return []
        return [json.loads(x) for x in open(fp).read().splitlines() if x.strip()]

    def test_empty_is_quiet(self):
        self.assertEqual(atlas_hook_guard.load_payload("h", "  \n"), {})
        self.assertEqual(self._faults(), [])

    def test_malformed_and_non_object_leave_trace(self):
        for raw in ("{nope", "[1,2]", "null", '"x"', "5"):
            with self.subTest(raw=raw):
                self.assertEqual(atlas_hook_guard.load_payload("h", raw), {})
        self.assertEqual(len(self._faults()), 5)

    def test_wrong_types_are_normalised_with_trace(self):
        data = atlas_hook_guard.load_payload(
            "h",
            json.dumps(
                {"tool_input": [1, 2], "prompt": 12, "session_id": 7, "cwd": "/x"}
            ),
        )
        self.assertEqual(data["tool_input"], {})
        self.assertEqual(data["prompt"], "")
        self.assertEqual(data["session_id"], "")
        self.assertEqual(data["cwd"], "/x")
        (fault,) = self._faults()
        for key in ("tool_input=list", "prompt=int", "session_id=int"):
            self.assertIn(key, fault["error"])

    def test_null_tool_input_is_normalised_quietly(self):
        data = atlas_hook_guard.load_payload("h", '{"tool_input": null}')
        self.assertEqual(data["tool_input"], {})
        self.assertEqual(self._faults(), [])

    def test_run_hook_turns_a_crash_into_a_fault_and_exit_zero(self):
        def boom():
            raise RuntimeError("kaput")

        self.assertEqual(atlas_hook_guard.run_hook("h", boom), 0)
        self.assertEqual(self._faults()[0]["error"], "kaput")


class HostilePayloadMatrixTests(unittest.TestCase):
    """Every core hook: rc 0, no traceback; empty is silent, bad input traced."""

    def test_matrix(self):
        cases = {
            "empty": (b"", False),
            "malformed": (b"{not json", True),
            "binary": (bytes(range(256)) * 4, True),
            "json_list": (b"[1,2]", True),
            "tool_input_list": (
                json.dumps(
                    {"tool_name": "Bash", "tool_input": [1, 2], "session_id": "s"}
                ).encode(),
                True,
            ),
            "tool_input_str": (
                json.dumps({"tool_name": "Edit", "tool_input": "x"}).encode(),
                True,
            ),
            "prompt_int": (
                json.dumps({"prompt": 12, "session_id": "s"}).encode(),
                True,
            ),
        }
        for hook in CORE:
            for name, (payload, traced) in cases.items():
                with self.subTest(hook=hook, case=name):
                    r, faults = _run(hook, payload)
                    self.assertEqual(r.returncode, 0, r.stderr.decode()[-400:])
                    self.assertNotIn(b"Traceback", r.stderr)
                    if traced:
                        self.assertTrue(faults, "no fault trace")
                    else:
                        self.assertEqual(faults, [])


class BreakerVisibilityTests(unittest.TestCase):
    def test_gate_bypass_is_traced_every_time(self):
        home = tempfile.mkdtemp()
        env = {
            "ATLAS_HOME": home,
            "ATLAS_DB": os.path.join(home, "atlas.db"),
            "ATLAS_HOOKSTATE_DIR": os.path.join(home, "hookstate"),
        }
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            tick = [1000.0]
            real_now = atlas_hook_guard._now
            atlas_hook_guard._now = lambda: tick[0]
            try:
                results = []
                import io
                from contextlib import redirect_stderr

                for i in range(9):
                    tick[0] += 3  # past STOP_EVENT_DEDUP_SECONDS, inside the window
                    err = io.StringIO()
                    with redirect_stderr(err):
                        ok = atlas_hook_guard.should_run(
                            {"session_id": "brk"}, "completion_gate"
                        )
                    results.append((ok, err.getvalue()))
            finally:
                atlas_hook_guard._now = real_now
            allowed = [ok for ok, _ in results]
            self.assertEqual(allowed, [True] * 5 + [False] * 4)
            for ok, text in results[5:]:
                self.assertIn("completion_gate BYPASSED", text)
            # A deliberate bypass is not a crash: no hook-faults row (the dashboard
            # would count it as hook_crash); the trip lives in hookstate instead.
            self.assertFalse(os.path.exists(os.path.join(home, "hook-faults.jsonl")))
            st = json.load(open(os.path.join(home, "hookstate", "brk.json")))
            self.assertTrue(st["breaker_tripped"])
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_non_gate_hook_traced_once_on_trip(self):
        home = tempfile.mkdtemp()
        old = {k: os.environ.get(k) for k in ("ATLAS_HOME", "ATLAS_HOOKSTATE_DIR")}
        os.environ["ATLAS_HOME"] = home
        os.environ["ATLAS_HOOKSTATE_DIR"] = os.path.join(home, "hookstate")
        try:
            tick = [5000.0]
            real_now = atlas_hook_guard._now
            atlas_hook_guard._now = lambda: tick[0]
            try:
                for _ in range(9):
                    tick[0] += 3
                    atlas_hook_guard.should_run({"session_id": "brk2"}, "nudge")
            finally:
                atlas_hook_guard._now = real_now
            self.assertFalse(os.path.exists(os.path.join(home, "hook-faults.jsonl")))
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


class DbUnusableTests(unittest.TestCase):
    def test_completion_gate_traces_unusable_db(self):
        home = tempfile.mkdtemp()
        blocker = os.path.join(home, "afile")
        open(blocker, "w").write("x")
        payload = json.dumps({"session_id": "s1", "cwd": home}).encode()
        r, faults = _run(
            "completion_gate", payload, {"ATLAS_DB": os.path.join(blocker, "atlas.db")}
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(any("DB unusable" in f["error"] for f in faults), faults)
        self.assertIn(b"orchestration gates inert", r.stderr)

    def test_prompt_optimizer_traces_failed_arm(self):
        home = tempfile.mkdtemp()
        blocker = os.path.join(home, "afile")
        open(blocker, "w").write("x")
        payload = json.dumps(
            {
                "session_id": "s1",
                "cwd": home,
                "prompt": "fix the failing test in src/app.py and add a regression test, "
                "traceback: TypeError in handler.py line 40",
            }
        ).encode()
        r, faults = _run(
            "prompt_optimizer",
            payload,
            {"ATLAS_DB": os.path.join(blocker, "atlas.db"), "ATLAS_ENGINE_ARM": "on"},
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(any("arm failed" in f["error"] for f in faults), faults)


class HooksJsonTests(unittest.TestCase):
    def setUp(self):
        with open(HOOKS_JSON) as f:
            self.entries = [
                h
                for ev in json.load(f)["hooks"].values()
                for ent in ev
                for h in ent["hooks"]
            ]

    def test_every_hook_has_a_sane_timeout(self):
        for h in self.entries:
            with self.subTest(cmd=h["command"]):
                self.assertIsInstance(h.get("timeout"), int)
                self.assertTrue(5 <= h["timeout"] <= 300, h["timeout"])

    def test_format_after_edit_is_async_as_documented(self):
        (h,) = [e for e in self.entries if "format_after_edit.py" in e["command"]]
        self.assertIs(h.get("async"), True)

    def test_fallow_budget_fits_hook_timeout(self):
        (h,) = [e for e in self.entries if "fallow_gate.py" in e["command"]]
        spent = (
            fallow_gate._NPX_PROBE_TIMEOUT
            + fallow_gate._VERSION_TIMEOUT
            + fallow_gate._AUDIT_TIMEOUT
        )
        self.assertLessEqual(spent, h["timeout"])


if __name__ == "__main__":
    unittest.main()
