import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

import bash_advisor  # noqa: E402
from bash_advisor import _match_catastrophic, _match_git_commit, main  # noqa: E402

HOOK_PATH = os.path.join(os.path.dirname(__file__), "bash_advisor.py")


def _run_main(payload: str) -> tuple[int, str]:
    """Call main() in-process with mocked stdin, capture stdout and exit code."""
    buf = io.StringIO()
    with patch("sys.stdin", new=io.StringIO(payload)), redirect_stdout(buf):
        code = main()
    return code, buf.getvalue()


class RmCatastrophicTest(unittest.TestCase):
    def test_rm_long_flag_recursive_force_detected(self):
        """rm with long-flag recursive + force on a root path must be flagged."""
        self.assertEqual(
            _match_catastrophic("rm --recursive --force /"),
            "recursive force-delete of a root/home path",
        )
        self.assertEqual(
            _match_catastrophic("rm -r --force /"),
            "recursive force-delete of a root/home path",
        )
        self.assertEqual(
            _match_catastrophic("rm --force -r /"),
            "recursive force-delete of a root/home path",
        )
        self.assertEqual(
            _match_catastrophic("rm --recursive --force ~"),
            "recursive force-delete of a root/home path",
        )

    def test_safe_rm_not_flagged(self):
        """Recursive force-delete of a build dir is not catastrophic-root."""
        self.assertIsNone(_match_catastrophic("rm -rf build/"))
        self.assertIsNone(_match_catastrophic("rm --recursive --force build/"))
        self.assertIsNone(_match_catastrophic("rm -r --force build/"))

    def test_short_flag_still_detected(self):
        """Existing short-flag detection must keep working."""
        self.assertEqual(
            _match_catastrophic("rm -rf /"),
            "recursive force-delete of a root/home path",
        )
        self.assertEqual(
            _match_catastrophic("rm -fr /"),
            "recursive force-delete of a root/home path",
        )


class MatchCatastrophicPatternsTest(unittest.TestCase):
    """Cover each catastrophic pattern beyond the rm variants."""

    def test_fork_bomb_detected(self):
        self.assertEqual(_match_catastrophic(":(){ :|:& };:"), "fork bomb")

    def test_mkfs_detected(self):
        self.assertEqual(
            _match_catastrophic("mkfs.ext4 /dev/sda1"), "filesystem format"
        )
        self.assertEqual(_match_catastrophic("mkfs /dev/sda1"), "filesystem format")

    def test_dd_to_disk_detected(self):
        self.assertEqual(
            _match_catastrophic("dd if=/dev/zero of=/dev/sda bs=1M"),
            "raw write to a disk device",
        )
        self.assertEqual(
            _match_catastrophic("dd of=/dev/nvme0n1"),
            "raw write to a disk device",
        )

    def test_redirect_over_disk_detected(self):
        self.assertEqual(
            _match_catastrophic("echo x > /dev/sda"),
            "redirect over a disk device",
        )

    def test_chmod_world_writable_root_detected(self):
        self.assertEqual(
            _match_catastrophic("chmod -R 0777 /"),
            "world-writable chmod on /",
        )
        self.assertEqual(
            _match_catastrophic("chmod -R 777 /"),
            "world-writable chmod on /",
        )

    def test_benign_commands_not_flagged(self):
        for cmd in [
            "ls -la",
            "echo hello",
            "rm file.txt",
            "git commit -m 'fix'",
            "chmod 644 file.txt",
            "dd if=/dev/zero of=/tmp/img bs=1M",
        ]:
            self.assertIsNone(_match_catastrophic(cmd), f"unexpected flag: {cmd}")


class MainInProcessTest(unittest.TestCase):
    """Call main() in-process to exercise the real code paths for coverage."""

    def test_catastrophic_command_emits_advisory_and_exits_zero(self):
        payload = json.dumps(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}}
        )
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertTrue(out.strip(), "expected JSON advisory on stdout")
        parsed = json.loads(out)
        self.assertIn("hookSpecificOutput", parsed)
        self.assertEqual(parsed["hookSpecificOutput"]["hookEventName"], "PreToolUse")
        self.assertIn("additionalContext", parsed["hookSpecificOutput"])
        self.assertIn("catastrophic", parsed["hookSpecificOutput"]["additionalContext"])
        # Advisory only: never a permissionDecision.
        self.assertNotIn("permissionDecision", parsed)

    def test_long_flag_catastrophic_emits_advisory(self):
        payload = json.dumps(
            {
                "tool_name": "Bash",
                "tool_input": {"command": "rm --recursive --force /"},
            }
        )
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertIn("additionalContext", json.loads(out)["hookSpecificOutput"])

    def test_benign_command_silent_exit_zero(self):
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls -la"}})
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_non_bash_tool_silent_exit_zero(self):
        payload = json.dumps(
            {"tool_name": "Write", "tool_input": {"command": "rm -rf /"}}
        )
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_tool_name_none_proceeds_as_bash(self):
        # tool_name absent -> defaults to None, which is allowed.
        payload = json.dumps({"tool_input": {"command": "ls"}})
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_empty_stdin_exit_zero(self):
        code, out = _run_main("")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_whitespace_stdin_exit_zero(self):
        code, out = _run_main("   \n  ")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_invalid_json_exit_zero(self):
        code, out = _run_main("{not json")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_command_not_a_string_exit_zero(self):
        payload = json.dumps(
            {"tool_name": "Bash", "tool_input": {"command": ["rm", "-rf", "/"]}}
        )
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_empty_command_exit_zero(self):
        payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": ""}})
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_missing_tool_input_exit_zero(self):
        payload = json.dumps({"tool_name": "Bash"})
        code, out = _run_main(payload)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_each_catastrophic_pattern_emits_advisory(self):
        commands = [
            "rm -rf /",
            "rm --recursive --force /",
            "rm -r --force /",
            ":(){ :|:& };:",
            "mkfs.ext4 /dev/sda1",
            "dd of=/dev/sda",
            "echo x > /dev/sda",
            "chmod -R 0777 /",
        ]
        for cmd in commands:
            with self.subTest(cmd=cmd):
                payload = json.dumps(
                    {"tool_name": "Bash", "tool_input": {"command": cmd}}
                )
                code, out = _run_main(payload)
                self.assertEqual(code, 0)
                self.assertTrue(out.strip(), f"expected advisory for: {cmd}")
                self.assertIn(
                    "additionalContext", json.loads(out)["hookSpecificOutput"]
                )


class SubprocessEndToEndTest(unittest.TestCase):
    """A few real subprocess invocations confirming exit codes."""

    def _run_hook(self, payload: dict) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, HOOK_PATH],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
        )

    def test_catastrophic_exit_zero_with_advisory(self):
        proc = self._run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}}
        )
        self.assertEqual(proc.returncode, 0)
        self.assertIn(
            "additionalContext", json.loads(proc.stdout)["hookSpecificOutput"]
        )

    def test_benign_exit_zero_silent(self):
        proc = self._run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls -la"}}
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, "")

    def test_non_bash_exit_zero_silent(self):
        proc = self._run_hook(
            {"tool_name": "Write", "tool_input": {"command": "rm -rf /"}}
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, "")

    def test_invalid_json_exit_zero(self):
        proc = subprocess.run(
            [sys.executable, HOOK_PATH],
            input="{not json",
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, "")


class GitCommitParseTest(unittest.TestCase):
    """Conservative git-commit tokenizer.

    Parse contract (mirrored 1:1 by omp/mandates.ts): shell operators
    (&& || ; |) split segments; leading NAME=value env assignments are
    skipped; the first remaining token must be `git` (or a path ending in
    /git); global options -C <path>, -c <key=val>, --git-dir=, --work-tree=,
    --exec-path=, --namespace= and a bare `--` are consumed; the next token
    must be exactly `commit`. Flags after the subcommand are irrelevant.
    Consequences: `git commit-tree ...` is NOT a commit (different token),
    `echo git commit` is NOT (echo wins), `git stash commit` is NOT
    (stash is not a consumed global option), `git commit --amend` IS.
    """

    def matches(self, cmd):
        return _match_git_commit(cmd)

    CASES = json.load(
        open(os.path.join(os.path.dirname(__file__), "..", "contracts", "mandates.json"))
    )["gitCommitCases"]

    def test_matches(self):
        for cmd in self.CASES["match"]:
            with self.subTest(cmd=cmd):
                self.assertTrue(self.matches(cmd))

    def test_non_matches(self):
        for cmd in self.CASES["noMatch"]:
            with self.subTest(cmd=cmd):
                self.assertFalse(self.matches(cmd))


class CommitReviewNudgeTest(unittest.TestCase):
    """Ponytail-before-commit mandate: one-time, armed, kill-switched."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # Point the one-time marker at a throwaway dir so tests never read or
        # write the real user temp state.
        self._marker = bash_advisor.MANDATE_MARKER_DIR
        bash_advisor.MANDATE_MARKER_DIR = self.tmp

    def tearDown(self):
        bash_advisor.MANDATE_MARKER_DIR = self._marker
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _payload(self, command, session_id="sess-pony-1"):
        return json.dumps(
            {
                "tool_name": "Bash",
                "tool_input": {"command": command},
                "session_id": session_id,
            }
        )

    def test_armed_git_commit_nudges_once(self):
        with mock.patch.object(bash_advisor, "_ponytail_installed", return_value=True):
            code, out = _run_main(self._payload("git commit -m 'wip'"))
            self.assertEqual(code, 0)
            ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
            self.assertEqual(ctx, bash_advisor._mandates()["commitNudge"])
            # One-time: a second commit in the SAME session stays silent.
            code2, out2 = _run_main(self._payload("git commit --amend"))
            self.assertEqual(code2, 0)
            self.assertEqual(out2, "")

    def test_armed_nudge_fires_again_for_a_new_session(self):
        with mock.patch.object(bash_advisor, "_ponytail_installed", return_value=True):
            code, out = _run_main(self._payload("git commit -m a", session_id="one"))
            self.assertEqual(code, 0)
            self.assertIn("ponytail-review", out)
            code2, out2 = _run_main(self._payload("git commit -m b", session_id="two"))
            self.assertEqual(code2, 0)
            self.assertIn("ponytail-review", out2)

    def test_unarmed_silent_when_ponytail_absent(self):
        with mock.patch.object(bash_advisor, "_ponytail_installed", return_value=False):
            code, out = _run_main(self._payload("git commit -m 'wip'"))
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_non_commit_commands_stay_silent_when_armed(self):
        with mock.patch.object(bash_advisor, "_ponytail_installed", return_value=True):
            for cmd in ("git commit-tree x", "echo git commit", "git status"):
                with self.subTest(cmd=cmd):
                    code, out = _run_main(self._payload(cmd))
                    self.assertEqual(code, 0)
                    self.assertEqual(out, "")

    def test_kill_switch_off_silences_mandate(self):
        with (
            mock.patch.object(bash_advisor, "_ponytail_installed", return_value=True),
            mock.patch.dict(os.environ, {"ATLAS_MANDATES": "off"}),
        ):
            code, out = _run_main(self._payload("git commit -m 'wip'"))
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_kill_switch_is_exactly_off(self):
        """Equivalence contract: both harnesses check the literal string "off";
        "Off" must not kill, or the two runtimes diverge."""
        with (
            mock.patch.object(bash_advisor, "_ponytail_installed", return_value=True),
            mock.patch.dict(os.environ, {"ATLAS_MANDATES": "Off"}),
        ):
            code, out = _run_main(self._payload("git commit -m 'wip'"))
        self.assertEqual(code, 0)
        self.assertIn("ponytail-review", out)

    def test_missing_session_id_stays_silent(self):
        """One-time needs a session key; absent id means no nudge (same
        behavior as dispatch_tripwire's session-gated nudges)."""
        with mock.patch.object(bash_advisor, "_ponytail_installed", return_value=True):
            code, out = _run_main(
                json.dumps({"tool_name": "Bash", "tool_input": {"command": "git commit"}})
            )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_malformed_json_fail_open(self):
        code, out = _run_main("{{bad json")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_catastrophic_warning_precedes_commit_nudge(self):
        """rm -rf / inside the payload must keep its advisory; the commit
        nudge never replaces/erases the existing advisor output."""
        with mock.patch.object(bash_advisor, "_ponytail_installed", return_value=True):
            code, out = _run_main(self._payload("rm -rf /"))
        self.assertEqual(code, 0)
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("catastrophic", ctx)
        self.assertNotIn("ponytail-review", ctx)


if __name__ == "__main__":
    unittest.main()
