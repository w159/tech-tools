import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

from bash_advisor import _match_catastrophic, main  # noqa: E402

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


if __name__ == "__main__":
    unittest.main()
