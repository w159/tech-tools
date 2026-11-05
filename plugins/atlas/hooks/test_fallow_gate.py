#!/usr/bin/env python3
"""Tests for hooks/fallow_gate.py - PreToolUse fallow agent gate."""

from __future__ import annotations

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
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
        with (
            mock.patch("sys.stdin", new=io.StringIO(raw)),
            redirect_stdout(out),
            redirect_stderr(err),
        ):
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

    def test_shell_c_wrapped_git_is_gated(self):
        for cmd in (
            "sh -c 'git commit -m x'",
            'bash -c "git push"',
            "bash -lc 'cd r; git commit -am m'",
            "sh -c \"bash -c 'git push'\"",
        ):
            self.assertTrue(fg._is_git_commit_or_push(cmd), cmd)
        self.assertFalse(fg._is_git_commit_or_push("sh -c 'git status'"))
        self.assertFalse(fg._is_git_commit_or_push("bash -c 'echo git commit'"))

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
        with (
            mock.patch.object(
                fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
            ),
            mock.patch.object(fg, "_fallow_version", return_value="2.90.0"),
            mock.patch.object(fg, "_run_audit", return_value=(1, audit, "")),
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
        with (
            mock.patch.object(
                fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
            ),
            mock.patch.object(fg, "_fallow_version", return_value="2.90.0"),
            mock.patch.object(
                fg, "_run_audit", return_value=(0, {"verdict": "pass"}, "")
            ),
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
        with (
            mock.patch.object(
                fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
            ),
            mock.patch.object(fg, "_fallow_version", return_value="2.90.0"),
            mock.patch.object(
                fg, "_run_audit", return_value=(0, {"verdict": "warn"}, "")
            ),
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
        with (
            mock.patch.object(
                fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
            ),
            mock.patch.object(fg, "_fallow_version", return_value="2.80.0"),
        ):
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
        with (
            mock.patch.object(
                fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
            ),
            mock.patch.object(fg, "_fallow_version", return_value="2.90.0"),
            mock.patch.object(
                fg,
                "_run_audit",
                return_value=(2, {"error": True, "message": "boom"}, ""),
            ),
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

    def test_rc0_unparseable_verdict_notices(self):
        # F13: rc 0 with an unparseable verdict used to pass silently; a lost
        # fail verdict is an enforcement hole, so the skip is announced.
        with (
            mock.patch.object(
                fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")
            ),
            mock.patch.object(fg, "_fallow_version", return_value="2.90.0"),
            mock.patch.object(fg, "_run_audit", return_value=(0, {}, "")),
        ):
            code, out, err = _run_main(
                {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}},
            )
        self.assertEqual(code, 0)
        self.assertEqual(out, "")
        self.assertIn("no parsable JSON verdict", err)

    def test_audit_timeout_is_capped_at_60s(self):
        self.assertEqual(fg._AUDIT_TIMEOUT, 60)


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


class ShellSyntaxBypassTests(unittest.TestCase):
    def test_wrapped_and_multiline_push_commit_gated(self):
        for cmd in (
            "cd repo\ngit commit -m x",
            "git --no-pager commit -m x",
            "(git commit -m x)",
            "time git push origin main",
            "xargs git commit",
            "env FOO=1 git push",
            "nohup git push",
            "git -C dir push",
            "git -c k=v commit -m x",
        ):
            self.assertTrue(fg._is_git_commit_or_push(cmd), cmd)


class NpxProbeNegativeCacheTests(unittest.TestCase):
    """H1: a missing fallow must not cost the npx probe timeout on every commit."""

    def setUp(self):
        import tempfile

        self._tmp = tempfile.mkdtemp()
        self._env = mock.patch.dict(os.environ, {"ATLAS_HOOKSTATE_DIR": self._tmp})
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_probe_timeout_is_short(self):
        self.assertLessEqual(fg._NPX_PROBE_TIMEOUT, 3)

    def test_not_installed_result_is_cached(self):
        calls = []

        def fake_run(*a, **k):
            calls.append(a)
            return subprocess.CompletedProcess(a, 1, "", "not found")

        with (
            mock.patch("shutil.which", side_effect=lambda n: "/x/npx" if n == "npx" else None),
            mock.patch("subprocess.run", side_effect=fake_run),
        ):
            self.assertIsNone(fg._resolve_runner())
            self.assertIsNone(fg._resolve_runner())
        self.assertEqual(len(calls), 1)

    def test_timeout_is_cached_too(self):
        calls = []

        def fake_run(*a, **k):
            calls.append(a)
            raise subprocess.TimeoutExpired("npx", 3)

        with (
            mock.patch("shutil.which", side_effect=lambda n: "/x/npx" if n == "npx" else None),
            mock.patch("subprocess.run", side_effect=fake_run),
        ):
            self.assertIsNone(fg._resolve_runner())
            self.assertIsNone(fg._resolve_runner())
        self.assertEqual(len(calls), 1)

    def test_cache_expires(self):
        fg._negative_store()
        old = os.path.getmtime(fg._negative_path()) - fg._NEGATIVE_TTL - 5
        os.utime(fg._negative_path(), (old, old))
        self.assertFalse(fg._negative_cached())


class EvalWrappedGateTests(unittest.TestCase):
    def test_eval_commit_is_gated(self):
        self.assertTrue(fg._is_git_commit_or_push('eval "git commit -m x"'))
        self.assertTrue(fg._is_git_commit_or_push("eval 'git push'"))


class ScanJsonTests(unittest.TestCase):
    def test_parses_object_with_surrounding_whitespace(self):
        self.assertEqual(fg._scan_json(' \t\r\n{"a": [1, 2.5, "x"]}\n '), {"a": [1, 2.5, "x"]})

    def test_trailing_data_raises(self):
        for raw in ('{"a": 1} x', "{} {}", "[1] 2"):
            with self.assertRaises(ValueError):
                fg._scan_json(raw)

    def test_malformed_raises(self):
        for raw in ("", "   ", "{not json", '{"a": }'):
            with self.assertRaises(Exception):
                fg._scan_json(raw)

    def test_control_characters_in_strings_are_accepted_like_strict_false(self):
        self.assertEqual(fg._scan_json('{"c": "a\nb\tc"}'), {"c": "a\nb\tc"})
        self.assertEqual(json.loads('{"c": "a\nb"}', strict=False), {"c": "a\nb"})

    def test_constants_become_floats(self):
        inf = float("inf")
        self.assertEqual(fg._scan_json("[Infinity, -Infinity]"), [inf, -inf])
        nan = fg._scan_json("[NaN]")[0]
        self.assertNotEqual(nan, nan)

    def test_numbers_and_literals(self):
        got = fg._scan_json('[1, 1.5, true, null]')
        self.assertEqual(got, [1, 1.5, True, None])
        self.assertIsInstance(got[0], int)
        self.assertIsInstance(got[1], float)


class PrefilterTests(unittest.TestCase):
    def skips(self, payload):
        raw = payload if isinstance(payload, str) else json.dumps(payload)
        return fg._prefilter_skips(raw)

    def test_unreadable_stdin_runs_the_gate(self):
        self.assertIs(fg._prefilter_skips(None), False)

    def test_empty_stdin_skips(self):
        self.assertIs(fg._prefilter_skips(""), True)
        self.assertIs(fg._prefilter_skips("  \n\t"), True)

    def test_command_without_git_is_not_a_gated_command(self):
        self.assertIs(fg._is_git_commit_or_push("ls -la"), False)
        self.assertIs(fg._is_git_commit_or_push(""), False)

    def test_command_without_git_skips(self):
        self.assertIs(self.skips({"tool_input": {"command": "ls -la"}}), True)

    def test_command_with_git_anywhere_runs_the_gate(self):
        for cmd in ("git commit -m x", "echo digit", "bash -c 'git push'", "/usr/bin/git status"):
            self.assertIs(self.skips({"tool_input": {"command": cmd}}), False, cmd)

    def test_missing_tool_input_or_command_skips(self):
        self.assertIs(self.skips({}), True)
        self.assertIs(self.skips({"tool_input": None}), True)
        self.assertIs(self.skips({"tool_input": {}}), True)
        self.assertIs(self.skips({"tool_input": {"command": None}}), True)

    def test_wrong_typed_tool_input_or_command_runs_the_gate(self):
        self.assertIs(self.skips({"tool_input": "git commit"}), False)
        self.assertIs(self.skips({"tool_input": ["x"]}), False)
        self.assertIs(self.skips({"tool_input": {"command": 5}}), False)
        self.assertIs(self.skips({"tool_input": {"command": ["ls"]}}), False)

    def test_wrong_typed_payload_field_runs_the_gate(self):
        for key in fg._PAYLOAD_STR_FIELDS:
            self.assertIs(self.skips({key: 5, "tool_input": {"command": "ls"}}), False, key)
            self.assertIs(self.skips({key: None, "tool_input": {"command": "ls"}}), True, key)
            self.assertIs(self.skips({key: "s", "tool_input": {"command": "ls"}}), True, key)

    def test_non_object_or_unparsable_payload_runs_the_gate(self):
        for raw in ("[]", '"git"', "5", "null", "{nope", '{"a": 1} trailing'):
            self.assertIs(fg._prefilter_skips(raw), False, raw)

    def test_payload_with_raw_newline_in_command_still_decodes(self):
        self.assertIs(fg._prefilter_skips('{"tool_input": {"command": "ls\n"}}'), True)

    def test_matches_the_hook_process_end_to_end(self):
        import tempfile

        with tempfile.TemporaryDirectory() as t:
            env = dict(os.environ, ATLAS_HOME=t, ATLAS_HOOKSTATE_DIR=t, ATLAS_FALLOW="on")
            run = lambda raw: subprocess.run(
                [sys.executable, HOOK_PATH], input=raw, capture_output=True, text=True, env=env, timeout=30
            )
            p = run(json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls"}}))
            self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "", ""))
            p = run("")
            self.assertEqual((p.returncode, p.stdout, p.stderr), (0, "", ""))


class SmallHelperTests(unittest.TestCase):
    def test_env_off_values_and_default(self):
        name = "ATLAS_FALLOW_TEST_FLAG"
        with mock.patch.dict(os.environ, clear=False):
            os.environ.pop(name, None)
            self.assertFalse(fg._env_off(name))
            for v in ("0", "off", "OFF", " False ", "no", "Disabled"):
                os.environ[name] = v
                self.assertTrue(fg._env_off(name), v)
            for v in ("on", "1", "yes", "", "true"):
                os.environ[name] = v
                self.assertFalse(fg._env_off(name), v)

    def test_command_from(self):
        self.assertEqual(fg._command_from({"tool_input": {"command": "git push"}}), "git push")
        self.assertEqual(fg._command_from({"tool_name": "Bash", "tool_input": {"command": "x"}}), "x")
        self.assertEqual(fg._command_from({"tool_name": "Write", "tool_input": {"command": "x"}}), "")
        self.assertEqual(fg._command_from({"tool_input": None}), "")
        self.assertEqual(fg._command_from({"tool_input": {}}), "")
        self.assertEqual(fg._command_from({"tool_input": {"command": 7}}), "")
        self.assertEqual(fg._command_from({}), "")

    def test_version_tuple(self):
        cases = {
            "2.85.0": (2, 85, 0),
            " 2.85.1\n": (2, 85, 1),
            "2.85": (2, 85, 0),
            "3": (3, 0, 0),
            "1.2.3.4": (1, 2, 3),
            "2.85.0-beta.1": (2, 85, 0),
            "10.0.0": (10, 0, 0),
        }
        for text, want in cases.items():
            self.assertEqual(fg._version_tuple(text), want, text)
        for text in ("", "v2.85.0", "abc"):
            self.assertIsNone(fg._version_tuple(text), text)

    def test_below_floor(self):
        self.assertTrue(fg._below_floor("2.84.9", "2.85.0"))
        self.assertTrue(fg._below_floor("1.99.99", "2.0.0"))
        self.assertFalse(fg._below_floor("2.85.0", "2.85.0"))
        self.assertFalse(fg._below_floor("2.85.1", "2.85.0"))
        self.assertFalse(fg._below_floor("10.0.0", "9.9.9"))
        self.assertIs(fg._below_floor("garbage", "2.85.0"), False)
        self.assertIs(fg._below_floor("2.80.0", "garbage"), False)

    def test_deny_prints_the_documented_block_form(self):
        out = io.StringIO()
        with redirect_stdout(out):
            fg._deny("why")
        self.assertEqual(
            json.loads(out.getvalue()),
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "why",
                }
            },
        )

    def test_notice_adds_one_newline_and_never_raises(self):
        err = io.StringIO()
        with redirect_stderr(err):
            fg._notice("a")
            fg._notice("b\n")
        self.assertEqual(err.getvalue(), "a\nb\n")

        class Broken:
            def write(self, _):
                raise ValueError("closed")

        with mock.patch.object(sys, "stderr", Broken()):
            fg._notice("x")

    def test_negative_cache_roundtrip_and_failure_swallowed(self):
        import tempfile

        with tempfile.TemporaryDirectory() as t, mock.patch.dict(os.environ, {"ATLAS_HOOKSTATE_DIR": t}):
            self.assertTrue(fg._negative_path().startswith(t))
            self.assertEqual(os.path.basename(fg._negative_path()), "fallow_gate_absent")
            self.assertFalse(fg._negative_cached())
            fg._negative_store()
            self.assertEqual(open(fg._negative_path()).read(), "1")
            self.assertTrue(fg._negative_cached())
            with mock.patch("os.makedirs", side_effect=OSError("ro")):
                fg._negative_store()


class ResolveRunnerTests(unittest.TestCase):
    def setUp(self):
        import tempfile

        self._tmp = tempfile.mkdtemp()
        env = mock.patch.dict(os.environ, {"ATLAS_HOOKSTATE_DIR": self._tmp})
        env.start()
        self.addCleanup(env.stop)

    def which(self, **found):
        return mock.patch("shutil.which", side_effect=lambda n: found.get(n))

    def test_fallow_on_path_wins_without_probing(self):
        with self.which(fallow="/bin/fallow", npx="/bin/npx"), mock.patch("subprocess.run") as run:
            self.assertEqual(fg._resolve_runner(), (["/bin/fallow"], "/bin/fallow"))
        run.assert_not_called()

    def test_neither_binary_found(self):
        with self.which(), mock.patch("subprocess.run") as run:
            self.assertIsNone(fg._resolve_runner())
        run.assert_not_called()

    def test_npx_probe_success(self):
        ok = subprocess.CompletedProcess([], 0, "fallow 2.90.0\n", "")
        with self.which(npx="/bin/npx"), mock.patch("subprocess.run", return_value=ok) as run:
            self.assertEqual(
                fg._resolve_runner(),
                (["/bin/npx", "--no-install", "fallow"], "npx --no-install fallow"),
            )
        self.assertEqual(run.call_args.args[0], ["/bin/npx", "--no-install", "fallow", "--version"])
        self.assertEqual(run.call_args.kwargs["timeout"], fg._NPX_PROBE_TIMEOUT)
        self.assertFalse(fg._negative_cached())

    def test_probe_name_may_arrive_on_stderr_in_any_case(self):
        ok = subprocess.CompletedProcess([], 0, "", "FALLOW 2.90.0")
        with self.which(npx="/bin/npx"), mock.patch("subprocess.run", return_value=ok):
            self.assertIsNotNone(fg._resolve_runner())

    def test_probe_failures_return_none_and_cache(self):
        bad = [
            subprocess.CompletedProcess([], 1, "fallow 2.90.0", ""),
            subprocess.CompletedProcess([], 0, "something else", ""),
            subprocess.CompletedProcess([], 0, None, None),
        ]
        for res in bad:
            if os.path.exists(fg._negative_path()):
                os.remove(fg._negative_path())
            with self.which(npx="/bin/npx"), mock.patch("subprocess.run", return_value=res):
                self.assertIsNone(fg._resolve_runner())
            self.assertTrue(fg._negative_cached())

    def test_oserror_probe_returns_none_and_caches(self):
        with self.which(npx="/bin/npx"), mock.patch("subprocess.run", side_effect=OSError("x")):
            self.assertIsNone(fg._resolve_runner())
        self.assertTrue(fg._negative_cached())

    def test_cached_negative_skips_probe_but_path_binary_still_wins(self):
        fg._negative_store()
        with self.which(npx="/bin/npx"), mock.patch("subprocess.run") as run:
            self.assertIsNone(fg._resolve_runner())
        run.assert_not_called()
        with self.which(fallow="/bin/fallow", npx="/bin/npx"):
            self.assertEqual(fg._resolve_runner()[0], ["/bin/fallow"])


class FallowVersionTests(unittest.TestCase):
    def version(self, stdout="", stderr="", **kw):
        res = subprocess.CompletedProcess([], 0, stdout, stderr)
        with mock.patch("subprocess.run", return_value=res, **kw) as run:
            return fg._fallow_version(["fallow"]), run

    def test_strips_name_prefix_and_trailing_words(self):
        self.assertEqual(self.version("fallow 2.85.0\n")[0], "2.85.0")
        self.assertEqual(self.version("Fallow   2.85.0 (build 7)")[0], "2.85.0")
        self.assertEqual(self.version("2.85.0")[0], "2.85.0")
        self.assertEqual(self.version("2.85.0 extra words")[0], "2.85.0")

    def test_falls_back_to_stderr_then_empty(self):
        self.assertEqual(self.version("", "fallow 1.2.3")[0], "1.2.3")
        self.assertEqual(self.version("", "")[0], "")
        self.assertEqual(self.version(None, None)[0], "")
        self.assertEqual(self.version("fallow")[0], "")

    def test_invocation(self):
        _, run = self.version("1.0.0")
        self.assertEqual(run.call_args.args[0], ["fallow", "--version"])
        self.assertEqual(run.call_args.kwargs["timeout"], fg._VERSION_TIMEOUT)
        self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_errors_give_empty_string(self):
        for exc in (OSError("x"), subprocess.TimeoutExpired("f", 1)):
            with mock.patch("subprocess.run", side_effect=exc):
                self.assertEqual(fg._fallow_version(["fallow"]), "")


class RunAuditTests(unittest.TestCase):
    def audit(self, stdout="", stderr="", rc=0, cwd="/w", runner=("fallow",)):
        res = subprocess.CompletedProcess([], rc, stdout, stderr)
        with mock.patch("subprocess.run", return_value=res) as run:
            return fg._run_audit(list(runner), cwd), run

    def test_parses_json_object(self):
        (rc, data, err), _ = self.audit('  {"verdict": "pass"}\n', " warn \n", rc=3)
        self.assertEqual((rc, data, err), (3, {"verdict": "pass"}, "warn"))

    def test_non_object_or_bad_or_empty_json_gives_empty_dict(self):
        for out in ("[1]", '"x"', "{bad", "", None, "   "):
            (rc, data, err), _ = self.audit(out)
            self.assertEqual((rc, data, err), (0, {}, ""), out)

    def test_command_line_and_options(self):
        _, run = self.audit('{"verdict": "pass"}', runner=("npx", "--no-install", "fallow"))
        self.assertEqual(
            run.call_args.args[0],
            ["npx", "--no-install", "fallow", "audit", "--format", "json", "--quiet", "--explain", "--gate-marker", "agent"],
        )
        kw = run.call_args.kwargs
        self.assertEqual((kw["timeout"], kw["cwd"], kw["text"], kw["capture_output"]), (60, "/w", True, True))

    def test_empty_cwd_means_current_directory(self):
        _, run = self.audit('{"verdict": "pass"}', cwd="")
        self.assertIsNone(run.call_args.kwargs["cwd"])
        _, run = self.audit('{"verdict": "pass"}', cwd=None)
        self.assertIsNone(run.call_args.kwargs["cwd"])

    def test_timeout_and_oserror(self):
        with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("f", 60)):
            self.assertEqual(fg._run_audit(["f"], None), (124, {}, "fallow audit timed out"))
        with mock.patch("subprocess.run", side_effect=OSError("no exec")):
            self.assertEqual(fg._run_audit(["f"], None), (127, {}, "no exec"))


class MainBranchTests(unittest.TestCase):
    PAYLOAD = {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}, "cwd": "/w"}

    def go(self, audit=(0, {"verdict": "pass"}, ""), version="2.90.0", env=None, payload=None):
        patches = (
            mock.patch.object(fg, "_resolve_runner", return_value=(["fallow"], "/bin/fallow")),
            mock.patch.object(fg, "_fallow_version", return_value=version),
            mock.patch.object(fg, "_run_audit", return_value=audit),
        )
        with patches[0], patches[1], patches[2] as run:
            full_env = {"ATLAS_FALLOW": "on"}
            full_env.update(env or {})
            result = _run_main(payload or self.PAYLOAD, env=full_env)
        return result, run

    def test_floor_equal_passes_and_empty_floor_disables(self):
        (code, out, _), run = self.go(version="2.85.0", env={"FALLOW_GATE_MIN_VERSION": "2.85.0"})
        self.assertEqual(out, "")
        run.assert_called_once()
        (code, out, _), run = self.go(version="1.0.0", env={"FALLOW_GATE_MIN_VERSION": "  "})
        self.assertEqual(out, "")
        run.assert_called_once()

    def test_default_floor_applies_when_env_unset(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("FALLOW_GATE_MIN_VERSION", None)
            (code, out, _), run = self.go(version="2.84.0")
        reason = json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("/bin/fallow is fallow 2.84.0, below required 2.85.0", reason)
        run.assert_not_called()

    def test_unknown_version_skips_floor(self):
        (_, out, _), run = self.go(version="", env={"FALLOW_GATE_MIN_VERSION": "9.0.0"})
        self.assertEqual(out, "")
        run.assert_called_once()

    def test_floor_denial_names_configured_minimum_trimmed(self):
        (_, out, _), run = self.go(version="1.0.0", env={"FALLOW_GATE_MIN_VERSION": " 3.1.0 "})
        reason = json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("below required 3.1.0.", reason)
        self.assertIn("ATLAS_FALLOW=off", reason)

    def test_audit_runs_in_payload_cwd_when_it_is_a_string(self):
        _, run = self.go()
        run.assert_called_once_with(["fallow"], "/w")
        payload = dict(self.PAYLOAD, cwd=5)
        _, run = self.go(payload=payload)
        self.assertFalse(run.call_args.args[1])

    def test_fail_verdict_is_case_insensitive_and_names_version(self):
        (_, out, _), _ = self.go(audit=(1, {"verdict": "FAIL", "n": 1}, ""), version="2.90.0")
        reason = json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertTrue(reason.startswith("fallow-gate: blocked by fallow 2.90.0 at /bin/fallow\n"))
        self.assertIn('"n": 1', reason)

    def test_fail_verdict_without_version_says_unknown(self):
        (_, out, _), _ = self.go(audit=(1, {"verdict": "fail"}, ""), version="")
        reason = json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("blocked by fallow unknown at", reason)

    def test_fail_body_is_truncated_at_12000_characters(self):
        big = {"verdict": "fail", "blob": "x" * 20000}
        (_, out, _), _ = self.go(audit=(1, big, ""))
        reason = json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"]
        body = reason.split("\n", 1)[1]
        self.assertTrue(body.endswith("\n... [truncated]"))
        self.assertEqual(len(body), 12000 + len("\n... [truncated]"))
        small = {"verdict": "fail", "blob": "x" * 100}
        (_, out, _), _ = self.go(audit=(1, small, ""))
        self.assertNotIn("truncated", out)

    def test_fail_verdict_wins_over_error_status(self):
        (_, out, err), _ = self.go(audit=(2, {"verdict": "fail", "error": True}, ""))
        self.assertIn('"permissionDecision": "deny"', out)
        self.assertEqual(err, "")

    def test_runtime_error_notices(self):
        (code, out, err), _ = self.go(audit=(2, {"message": "boom"}, ""))
        self.assertEqual((code, out, err), (0, "", "fallow-gate: fallow audit runtime error (boom), skipping.\n"))
        (_, out, err), _ = self.go(audit=(2, {}, ""))
        self.assertEqual((out, err), ("", "fallow-gate: fallow audit runtime error, skipping.\n"))
        (_, out, err), _ = self.go(audit=(0, {"error": True, "message": 5}, ""))
        self.assertEqual((out, err), ("", "fallow-gate: fallow audit runtime error, skipping.\n"))
        (_, out, err), _ = self.go(audit=(0, {"error": "yes", "verdict": "pass"}, ""))
        self.assertEqual((out, err), ("", ""))

    def test_nonzero_exit_notices_first_stderr_line(self):
        (code, out, err), _ = self.go(audit=(5, {"verdict": "pass"}, "bad flag\nmore"))
        self.assertEqual((code, out, err), (0, "", "fallow-gate: fallow audit exited 5 (bad flag), skipping.\n"))
        (_, out, err), _ = self.go(audit=(124, {}, ""))
        self.assertEqual((out, err), ("", "fallow-gate: fallow audit exited 124, skipping.\n"))

    def test_clean_pass_is_silent(self):
        (code, out, err), _ = self.go(audit=(0, {"verdict": "Pass"}, ""))
        self.assertEqual((code, out, err), (0, "", ""))

    def test_missing_verdict_notice_text(self):
        (_, out, err), _ = self.go(audit=(0, {"other": 1}, ""))
        self.assertEqual(out, "")
        self.assertIn("returned no parsable JSON verdict", err)
        self.assertIn("(fail-open)", err)


if __name__ == "__main__":
    unittest.main()
