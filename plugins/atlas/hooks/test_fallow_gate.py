#!/usr/bin/env python3
"""Tests for hooks/fallow_gate.py - PreToolUse fallow agent gate."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

import fallow_gate as fg  # noqa: E402

HOOK_PATH = os.path.join(os.path.dirname(__file__), "fallow_gate.py")


def _run_main(payload, env=None) -> tuple[int, str, str]:
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    out = io.StringIO()
    err = io.StringIO()
    with mock.patch.dict(os.environ, env or {}, clear=False):
        with mock.patch("sys.stdin", new=io.StringIO(raw)), redirect_stdout(
            out
        ), redirect_stderr(err):
            code = fg.main()
    return code, out.getvalue(), err.getvalue()


class PatternTests(unittest.TestCase):
    def test_git_commit_and_push_detected(self):
        for cmd in (
            "git commit -m 'x'",
            "git push origin main",
            "cd repo && git commit -am msg",
            "git  commit -m x",
        ):
            self.assertTrue(fg._is_git_commit_or_push(cmd), cmd)

    def test_non_gate_commands(self):
        for cmd in (
            "git status",
            "git log",
            "echo 'git commit'",  # quoted prose, not a shell git token sequence
            "git-commit",  # hyphenated binary name, not `git commit`
            "ls",
            "git commit-tree",
            "git push-to-checkout",
        ):
            self.assertFalse(fg._is_git_commit_or_push(cmd), cmd)

    def test_version_floor(self):
        self.assertTrue(fg._below_floor("2.84.0", "2.85.0"))
        self.assertFalse(fg._below_floor("2.85.0", "2.85.0"))
        self.assertFalse(fg._below_floor("3.0.0", "2.85.0"))
        self.assertFalse(fg._below_floor("not-a-version", "2.85.0"))


class MainBehaviorTests(unittest.TestCase):
    def test_off_env_skips(self):
        code, out, err = _run_main(
            {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}},
            env={"ATLAS_FALLOW": "off"},
        )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_non_git_silent(self):
        code, out, err = _run_main(
            {"tool_name": "Bash", "tool_input": {"command": "ls -la"}},
            env={"ATLAS_FALLOW": "on"},
        )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_non_bash_silent(self):
        code, out, _ = _run_main(
            {"tool_name": "Write", "tool_input": {"command": "git commit -m x"}},
        )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_invalid_json_silent(self):
        code, out, _ = _run_main("{not json")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_missing_fallow_skips_with_notice(self):
        with mock.patch.object(fg, "_resolve_runner", return_value=None):
            code, out, err = _run_main(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "git commit -m x"},
                },
                env={"ATLAS_FALLOW": "on"},
            )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")
        self.assertIn("fallow binary not found", err)

    def test_fail_verdict_denies(self):
        audit = {"verdict": "fail", "issues": [{"id": "unused-export"}]}
        with mock.patch.object(
            fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
        ), mock.patch.object(fg, "_fallow_version", return_value="2.90.0"), mock.patch.object(
            fg, "_run_audit", return_value=(1, audit, "")
        ):
            code, out, err = _run_main(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "git push"},
                    "cwd": "/tmp",
                },
                env={"ATLAS_FALLOW": "on", "FALLOW_GATE_MIN_VERSION": "2.85.0"},
            )
        self.assertEqual(code, 0)
        payload = json.loads(out)
        hso = payload["hookSpecificOutput"]
        self.assertEqual(hso["hookEventName"], "PreToolUse")
        self.assertEqual(hso["permissionDecision"], "deny")
        self.assertIn("fallow-gate: blocked", hso["permissionDecisionReason"])
        self.assertIn("unused-export", hso["permissionDecisionReason"])

    def test_pass_verdict_allows(self):
        with mock.patch.object(
            fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
        ), mock.patch.object(fg, "_fallow_version", return_value="2.90.0"), mock.patch.object(
            fg, "_run_audit", return_value=(0, {"verdict": "pass"}, "")
        ):
            code, out, err = _run_main(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "git commit -m ok"},
                },
                env={"ATLAS_FALLOW": "on"},
            )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_warn_verdict_allows(self):
        with mock.patch.object(
            fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
        ), mock.patch.object(fg, "_fallow_version", return_value="2.90.0"), mock.patch.object(
            fg, "_run_audit", return_value=(0, {"verdict": "warn"}, "")
        ):
            code, out, _ = _run_main(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "git commit -m ok"},
                },
            )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_version_floor_denies(self):
        with mock.patch.object(
            fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
        ), mock.patch.object(fg, "_fallow_version", return_value="2.80.0"):
            code, out, _ = _run_main(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "git commit -m x"},
                },
                env={"FALLOW_GATE_MIN_VERSION": "2.85.0"},
            )
        self.assertEqual(code, 0)
        hso = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(hso["permissionDecision"], "deny")
        self.assertIn("below required", hso["permissionDecisionReason"])

    def test_runtime_error_fail_open(self):
        with mock.patch.object(
            fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
        ), mock.patch.object(fg, "_fallow_version", return_value="2.90.0"), mock.patch.object(
            fg,
            "_run_audit",
            return_value=(2, {"error": True, "message": "boom"}, ""),
        ):
            code, out, err = _run_main(
                {
                    "tool_name": "Bash",
                    "tool_input": {"command": "git commit -m x"},
                },
            )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")
        self.assertIn("runtime error", err)


class SubprocessEndToEndTest(unittest.TestCase):
    def test_benign_subprocess(self):
        proc = subprocess.run(
            [sys.executable, HOOK_PATH],
            input=json.dumps(
                {"tool_name": "Bash", "tool_input": {"command": "echo hi"}}
            ),
            capture_output=True,
            text=True,
            env={**os.environ, "ATLAS_FALLOW": "on"},
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, "")


if __name__ == "__main__":
    unittest.main()
