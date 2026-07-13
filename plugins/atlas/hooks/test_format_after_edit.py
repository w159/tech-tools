"""Integration tests for format_after_edit PostToolUse hook.

Coverage strategy: import the hook module in-process and drive its main() with
mocked sys.stdin / subprocess / shutil.which. A few subprocess end-to-end exit
code tests round things out; the coverage comes from the in-process calls.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

import format_after_edit  # noqa: E402

HOOK = os.path.join(os.path.dirname(__file__), "format_after_edit.py")


def _run_hook_subprocess(payload):
    """Run the hook as a real subprocess; returns the CompletedProcess."""
    return subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )


def _payload(tool_name, file_path, cwd=None):
    return {"tool_name": tool_name, "tool_input": {"file_path": file_path}, "cwd": cwd}


class CandidatesTest(unittest.TestCase):
    """candidates_for: extension -> argv resolution, formatter-present logic."""

    def setUp(self):
        # Use a temp cwd so node_modules lookups are deterministic.
        self.tmp = tempfile.mkdtemp()
        self.cwd = self.tmp

    def test_python_prefers_ruff_over_black(self):
        with mock.patch.object(
            format_after_edit.shutil, "which", side_effect=lambda c: c == "ruff"
        ):
            out = format_after_edit.candidates_for("foo.py", self.cwd)
        self.assertEqual(out, [["ruff", "format"]])

    def test_python_falls_back_to_black_when_no_ruff(self):
        def which(c):
            return c == "black"

        with mock.patch.object(format_after_edit.shutil, "which", side_effect=which):
            out = format_after_edit.candidates_for("x.py", self.cwd)
        self.assertEqual(out, [["black", "-q"]])

    def test_python_no_formatters_returns_empty(self):
        with mock.patch.object(format_after_edit.shutil, "which", return_value=None):
            out = format_after_edit.candidates_for("x.py", self.cwd)
        self.assertEqual(out, [])

    def test_prettier_local_node_modules_wins(self):
        local = os.path.join(self.cwd, "node_modules", ".bin", "prettier")
        os.makedirs(os.path.dirname(local), exist_ok=True)
        with open(local, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(local, 0o755)
        try:
            with mock.patch.object(
                format_after_edit.shutil, "which", return_value=None
            ):
                out = format_after_edit.candidates_for("a.js", self.cwd)
            self.assertEqual(out, [[local, "--write", "--log-level", "warn"]])
        finally:
            os.chmod(local, 0o644)

    def test_prettier_global_when_no_local(self):
        with mock.patch.object(
            format_after_edit.shutil, "which", side_effect=lambda c: c == "prettier"
        ):
            out = format_after_edit.candidates_for("a.ts", self.cwd)
        self.assertEqual(out, [["prettier", "--write", "--log-level", "warn"]])

    def test_prettier_both_local_and_global(self):
        local = os.path.join(self.cwd, "node_modules", ".bin", "prettier")
        os.makedirs(os.path.dirname(local), exist_ok=True)
        with open(local, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(local, 0o755)
        try:
            with mock.patch.object(
                format_after_edit.shutil, "which", side_effect=lambda c: c == "prettier"
            ):
                out = format_after_edit.candidates_for("a.json", self.cwd)
            self.assertEqual(len(out), 2)
            self.assertEqual(out[0], [local, "--write", "--log-level", "warn"])
            self.assertEqual(out[1], ["prettier", "--write", "--log-level", "warn"])
        finally:
            os.chmod(local, 0o644)

    def test_prettier_exts_covered(self):
        with mock.patch.object(format_after_edit.shutil, "which", return_value=None):
            for ext in (
                ".jsx",
                ".tsx",
                ".mjs",
                ".cjs",
                ".jsonc",
                ".css",
                ".scss",
                ".less",
                ".html",
                ".vue",
                ".svelte",
                ".md",
                ".mdx",
                ".yaml",
                ".yml",
                ".graphql",
            ):
                self.assertEqual(
                    format_after_edit.candidates_for("f" + ext, self.cwd),
                    [],
                    f"ext {ext} should resolve to empty when nothing installed",
                )

    def test_gofmt_present(self):
        with mock.patch.object(
            format_after_edit.shutil, "which", side_effect=lambda c: c == "gofmt"
        ):
            out = format_after_edit.candidates_for("main.go", self.cwd)
        self.assertEqual(out, [["gofmt", "-w"]])

    def test_gofmt_absent_no_go_candidate(self):
        with mock.patch.object(format_after_edit.shutil, "which", return_value=None):
            self.assertEqual(format_after_edit.candidates_for("main.go", self.cwd), [])

    def test_rustfmt_present(self):
        with mock.patch.object(
            format_after_edit.shutil, "which", side_effect=lambda c: c == "rustfmt"
        ):
            out = format_after_edit.candidates_for("lib.rs", self.cwd)
        self.assertEqual(out, [["rustfmt"]])

    def test_rustfmt_absent(self):
        with mock.patch.object(format_after_edit.shutil, "which", return_value=None):
            self.assertEqual(format_after_edit.candidates_for("lib.rs", self.cwd), [])

    def test_unknown_extension_returns_empty(self):
        with mock.patch.object(format_after_edit.shutil, "which", return_value=None):
            self.assertEqual(
                format_after_edit.candidates_for("readme.txt", self.cwd), []
            )
            self.assertEqual(format_after_edit.candidates_for("Makefile", self.cwd), [])

    def test_extension_case_insensitive(self):
        with mock.patch.object(format_after_edit.shutil, "which", return_value=None):
            self.assertEqual(format_after_edit.candidates_for("X.PY", self.cwd), [])


class FilePathTest(unittest.TestCase):
    """file_path_from: pull the edited path out of the hook payload."""

    def test_file_path_key(self):
        self.assertEqual(
            format_after_edit.file_path_from({"tool_input": {"file_path": "/a/b.py"}}),
            "/a/b.py",
        )

    def test_path_key(self):
        self.assertEqual(
            format_after_edit.file_path_from({"tool_input": {"path": "/c/d.go"}}),
            "/c/d.go",
        )

    def test_notebook_path_key(self):
        self.assertEqual(
            format_after_edit.file_path_from(
                {"tool_input": {"notebook_path": "/n.ipynb"}}
            ),
            "/n.ipynb",
        )

    def test_missing_tool_input(self):
        self.assertIsNone(format_after_edit.file_path_from({}))

    def test_empty_tool_input(self):
        self.assertIsNone(format_after_edit.file_path_from({"tool_input": {}}))

    def test_non_string_path(self):
        self.assertIsNone(
            format_after_edit.file_path_from({"tool_input": {"file_path": 42}})
        )

    def test_empty_string_path(self):
        self.assertIsNone(
            format_after_edit.file_path_from({"tool_input": {"file_path": ""}})
        )


class MainInProcessTest(unittest.TestCase):
    """Drive main() in-process with mocked stdin/subprocess."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.target = os.path.join(self.tmp, "edited.py")
        with open(self.target, "w") as f:
            f.write("x = 1\n")

    def _run_main(self, payload):
        buf = io.StringIO(json.dumps(payload))
        with mock.patch.object(sys, "stdin", new=buf):
            return format_after_edit.main()

    def test_success_path_prints_context_and_returns_zero(self):
        payload = _payload("Edit", self.target, cwd=self.tmp)

        class FakeProc:
            returncode = 0

        def fake_run(cmd, **kw):
            assert cmd[-1] == self.target
            return FakeProc()

        with (
            mock.patch.object(
                format_after_edit.shutil, "which", side_effect=lambda c: c == "ruff"
            ),
            mock.patch.object(
                format_after_edit.subprocess, "run", side_effect=fake_run
            ),
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        prn.assert_called_once()
        emitted = json.loads(prn.call_args[0][0])
        self.assertEqual(emitted["hookSpecificOutput"]["hookEventName"], "PostToolUse")
        self.assertIn(
            "auto-formatted edited.py with ruff",
            emitted["hookSpecificOutput"]["additionalContext"],
        )

    def test_first_candidate_fails_then_second_succeeds(self):
        payload = _payload("Write", self.target, cwd=self.tmp)

        class Proc0:
            returncode = 1

        class Proc1:
            returncode = 0

        seq = [Proc0(), Proc1()]

        def fake_run(cmd, **kw):
            return seq.pop(0)

        with (
            mock.patch.object(format_after_edit.shutil, "which", return_value="x"),
            mock.patch.object(
                format_after_edit.subprocess, "run", side_effect=fake_run
            ),
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        emitted = json.loads(prn.call_args[0][0])
        self.assertIn("black", emitted["hookSpecificOutput"]["additionalContext"])

    def test_all_candidates_fail_returns_zero_silently(self):
        payload = _payload("MultiEdit", self.target, cwd=self.tmp)

        class Bad:
            returncode = 2

        with (
            mock.patch.object(format_after_edit.shutil, "which", return_value="x"),
            mock.patch.object(format_after_edit.subprocess, "run", return_value=Bad()),
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        prn.assert_not_called()

    def test_formatter_not_installed_noop(self):
        payload = _payload("Edit", self.target, cwd=self.tmp)
        with (
            mock.patch.object(format_after_edit.shutil, "which", return_value=None),
            mock.patch.object(format_after_edit.subprocess, "run") as run,
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        run.assert_not_called()
        prn.assert_not_called()

    def test_subprocess_filenotfound_swallowed(self):
        """FileNotFoundError (formatter binary vanished) -> try next, give up quietly."""
        payload = _payload("Edit", self.target, cwd=self.tmp)

        def fake_run(cmd, **kw):
            raise FileNotFoundError(2, "no such file", cmd[0])

        with (
            mock.patch.object(format_after_edit.shutil, "which", return_value="x"),
            mock.patch.object(
                format_after_edit.subprocess, "run", side_effect=fake_run
            ),
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        prn.assert_not_called()

    def test_subprocess_timeout_swallowed(self):
        payload = _payload("Edit", self.target, cwd=self.tmp)

        def fake_run(cmd, **kw):
            raise subprocess.TimeoutExpired(cmd=cmd, timeout=55)

        with (
            mock.patch.object(
                format_after_edit.shutil, "which", side_effect=lambda c: c == "ruff"
            ),
            mock.patch.object(
                format_after_edit.subprocess, "run", side_effect=fake_run
            ),
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        prn.assert_not_called()

    def test_subprocess_oserror_swallowed(self):
        payload = _payload("Edit", self.target, cwd=self.tmp)

        def fake_run(cmd, **kw):
            raise OSError("boom")

        with (
            mock.patch.object(format_after_edit.shutil, "which", return_value="x"),
            mock.patch.object(
                format_after_edit.subprocess, "run", side_effect=fake_run
            ),
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        prn.assert_not_called()

    def test_non_edit_tool_name_still_formats_by_extension(self):
        """Hook keys off file_path existence, not tool_name; an unknown tool with a
        real file still formats. This documents current behavior."""
        payload = _payload("Read", self.target, cwd=self.tmp)

        class Proc0:
            returncode = 0

        with (
            mock.patch.object(
                format_after_edit.shutil, "which", side_effect=lambda c: c == "ruff"
            ),
            mock.patch.object(
                format_after_edit.subprocess, "run", return_value=Proc0()
            ),
            mock.patch("builtins.print"),
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)

    def test_no_file_path_noop(self):
        payload = {"tool_name": "Edit", "tool_input": {}, "cwd": self.tmp}
        with mock.patch.object(format_after_edit.subprocess, "run") as run:
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        run.assert_not_called()

    def test_file_does_not_exist_noop(self):
        payload = _payload("Edit", "/no/such/file.py", cwd=self.tmp)
        with mock.patch.object(format_after_edit.subprocess, "run") as run:
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        run.assert_not_called()

    def test_missing_cwd_falls_back_to_getcwd(self):
        payload = _payload("Edit", self.target)  # no cwd key
        with (
            mock.patch.object(format_after_edit.shutil, "which", return_value=None),
            mock.patch.object(format_after_edit.os, "getcwd", return_value=self.tmp),
            mock.patch.object(format_after_edit.subprocess, "run") as run,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        run.assert_not_called()

    def test_empty_stdin_returns_zero(self):
        buf = io.StringIO("")
        with mock.patch.object(sys, "stdin", new=buf):
            self.assertEqual(format_after_edit.main(), 0)

    def test_invalid_json_returns_zero(self):
        buf = io.StringIO("not json at all")
        with mock.patch.object(sys, "stdin", new=buf):
            self.assertEqual(format_after_edit.main(), 0)

    def test_whitespace_only_stdin_returns_zero(self):
        buf = io.StringIO("   \n  ")
        with mock.patch.object(sys, "stdin", new=buf):
            self.assertEqual(format_after_edit.main(), 0)

    def test_unknown_extension_noop(self):
        target = os.path.join(self.tmp, "data.txt")
        with open(target, "w") as f:
            f.write("hi")
        payload = _payload("Edit", target, cwd=self.tmp)
        with (
            mock.patch.object(format_after_edit.shutil, "which", return_value=None),
            mock.patch.object(format_after_edit.subprocess, "run") as run,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        run.assert_not_called()

    def test_js_uses_prettier_success(self):
        target = os.path.join(self.tmp, "app.js")
        with open(target, "w") as f:
            f.write("var x=1")
        payload = _payload("Edit", target, cwd=self.tmp)

        class Proc0:
            returncode = 0

        with (
            mock.patch.object(
                format_after_edit.shutil, "which", side_effect=lambda c: c == "prettier"
            ),
            mock.patch.object(
                format_after_edit.subprocess, "run", return_value=Proc0()
            ),
            mock.patch("builtins.print") as prn,
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)
        emitted = json.loads(prn.call_args[0][0])
        self.assertIn("app.js", emitted["hookSpecificOutput"]["additionalContext"])

    def test_go_success_with_gofmt(self):
        target = os.path.join(self.tmp, "main.go")
        with open(target, "w") as f:
            f.write("package main")
        payload = _payload("Edit", target, cwd=self.tmp)

        class Proc0:
            returncode = 0

        with (
            mock.patch.object(
                format_after_edit.shutil, "which", side_effect=lambda c: c == "gofmt"
            ),
            mock.patch.object(
                format_after_edit.subprocess, "run", return_value=Proc0()
            ),
            mock.patch("builtins.print"),
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)

    def test_rs_success_with_rustfmt(self):
        target = os.path.join(self.tmp, "lib.rs")
        with open(target, "w") as f:
            f.write("fn main(){}")
        payload = _payload("Edit", target, cwd=self.tmp)

        class Proc0:
            returncode = 0

        with (
            mock.patch.object(
                format_after_edit.shutil, "which", side_effect=lambda c: c == "rustfmt"
            ),
            mock.patch.object(
                format_after_edit.subprocess, "run", return_value=Proc0()
            ),
            mock.patch("builtins.print"),
        ):
            rc = self._run_main(payload)
        self.assertEqual(rc, 0)


class SubprocessEndToEndTest(unittest.TestCase):
    """A few real-subprocess exit-code checks (these do not contribute to coverage)."""

    def test_empty_stdin_exits_zero(self):
        r = subprocess.run(
            [sys.executable, HOOK],
            input="",
            capture_output=True,
            text=True,
        )
        self.assertEqual(r.returncode, 0)

    def test_bad_json_exits_zero(self):
        r = subprocess.run(
            [sys.executable, HOOK],
            input="{not json",
            capture_output=True,
            text=True,
        )
        self.assertEqual(r.returncode, 0)

    def test_missing_file_exits_zero(self):
        r = _run_hook_subprocess(_payload("Edit", "/no/such/file.py"))
        self.assertEqual(r.returncode, 0)

    def test_no_tool_input_exits_zero(self):
        r = _run_hook_subprocess({"tool_name": "Edit"})
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
