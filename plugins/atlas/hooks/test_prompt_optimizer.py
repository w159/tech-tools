"""In-process coverage tests for prompt_optimizer.py.

Coverage strategy: import the hook module in-process and drive its real code
paths with mocked stdin (sys.stdin), mocked env (os.environ), and mocked
external calls (subprocess.run, urllib, shutil.which, atlas_db). A few
subprocess end-to-end exit-code tests round it out, but the line coverage
comes from the in-process calls.
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

import prompt_optimizer as po  # noqa: E402

HOOK = os.path.join(os.path.dirname(__file__), "prompt_optimizer.py")


def _stdin(payload: dict) -> io.StringIO:
    return io.StringIO(json.dumps(payload))


def _run_hook_subprocess(payload, env):
    return subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class CleanTest(unittest.TestCase):
    def test_plain_text_passthrough(self):
        self.assertEqual(po.clean("hello world"), "hello world")

    def test_osc_sequence_stripped(self):
        self.assertEqual(po.clean("\x1b]0;title\x07hello"), "hello")

    def test_csi_cursor_back_and_erase(self):
        # "data c" + cursor-back-1 + erase-to-end -> "data "
        text = "data c\x1b[1D\x1b[K"
        self.assertEqual(po.clean(text), "data")

    def test_csi_cursor_forward(self):
        # cursor forward then write overwrites at new position
        text = "ab\x1b[1Cx"
        result = po.clean(text)
        self.assertIn("ab", result)

    def test_unknown_csi_ignored(self):
        # color codes (m) are ignored, text remains
        self.assertEqual(po.clean("\x1b[31mred\x1b[0m"), "red")

    def test_lone_escape_no_csi(self):
        # bare escape with no following CSI -> skipped
        self.assertEqual(po.clean("a\x1bb"), "ab")

    def test_carriage_return_and_newline(self):
        self.assertEqual(po.clean("abc\rdef\nghi"), "def\nghi")

    def test_backspace(self):
        self.assertEqual(po.clean("abcd\x08x"), "abcx")

    def test_blank_lines_trimmed(self):
        self.assertEqual(po.clean("\n\n  real  \n\n"), "real")

    def test_empty_returns_empty(self):
        self.assertEqual(po.clean(""), "")


class MatchTriggerTest(unittest.TestCase):
    def test_match_prefix(self):
        matched, body = po.match_trigger("opt: do thing", ("opt:", "++"))
        self.assertTrue(matched)
        self.assertEqual(body, "do thing")

    def test_match_case_insensitive(self):
        matched, _ = po.match_trigger("OPT: x", ("opt:",))
        self.assertTrue(matched)

    def test_no_match(self):
        matched, body = po.match_trigger("hello", ("opt:",))
        self.assertFalse(matched)
        self.assertEqual(body, "hello")

    def test_empty_trigger_skipped(self):
        matched, _ = po.match_trigger("x", ("", "x"))
        # "" entries are skipped; "x" prefix matches
        self.assertTrue(matched)


class ShouldOptimizeTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        # clean slate for the atlas env knobs
        for k in (
            "ATLAS_OPTIMIZE",
            "ATLAS_OPTIMIZE_TRIGGER",
            "ATLAS_OPTIMIZE_MINLEN",
        ):
            os.environ.pop(k, None)

    def tearDown(self):
        self.env.stop()

    def test_off_mode(self):
        os.environ["ATLAS_OPTIMIZE"] = "off"
        self.assertEqual(
            po.should_optimize("opt: real work here"), (False, "opt: real work here")
        )

    def test_slash_command_never(self):
        os.environ["ATLAS_OPTIMIZE"] = "always"
        self.assertEqual(po.should_optimize("/help me"), (False, "/help me"))

    def test_always_mode_short_prompt_skipped(self):
        os.environ["ATLAS_OPTIMIZE"] = "always"
        os.environ["ATLAS_OPTIMIZE_MINLEN"] = "12"
        do, _ = po.should_optimize("ok")
        self.assertFalse(do)

    def test_always_mode_long_prompt(self):
        os.environ["ATLAS_OPTIMIZE"] = "always"
        do, body = po.should_optimize("this is a long enough prompt for always mode")
        self.assertTrue(do)
        self.assertEqual(body, "this is a long enough prompt for always mode")

    def test_always_mode_trigger_strips_prefix(self):
        os.environ["ATLAS_OPTIMIZE"] = "always"
        do, body = po.should_optimize("opt: do the thing with enough text")
        self.assertTrue(do)
        self.assertEqual(body, "do the thing with enough text")

    def test_trigger_mode_no_match(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        do, _ = po.should_optimize("just chatting with no prefix")
        self.assertFalse(do)

    def test_trigger_mode_match_too_short(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        os.environ["ATLAS_OPTIMIZE_MINLEN"] = "50"
        do, _ = po.should_optimize("opt: tiny")
        self.assertFalse(do)

    def test_trigger_mode_match_long_enough(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        do, body = po.should_optimize("opt: build the feature end to end")
        self.assertTrue(do)
        self.assertEqual(body, "build the feature end to end")


class OverrideCommandTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_no_override(self):
        os.environ.pop("ATLAS_OPTIMIZE_CMD", None)
        self.assertIsNone(po.override_command("x"))

    def test_override_with_prompt_token(self):
        os.environ["ATLAS_OPTIMIZE_CMD"] = "echo {prompt} done"
        self.assertEqual(
            po.override_command("hello world"), ["echo", "hello world", "done"]
        )

    def test_override_without_token_appends(self):
        os.environ["ATLAS_OPTIMIZE_CMD"] = "optimizer --stdin"
        self.assertEqual(po.override_command("p"), ["optimizer", "--stdin", "p"])


class RunArgvTest(unittest.TestCase):
    def test_success(self):
        with mock.patch("prompt_optimizer.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="out\n", stderr=""
            )
            self.assertEqual(po._run_argv(["x"], 10.0), "out")

    def test_timeout_returns_none(self):
        with mock.patch(
            "prompt_optimizer.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="x", timeout=1),
        ):
            self.assertIsNone(po._run_argv(["x"], 1.0))

    def test_filenotfound_returns_none(self):
        with mock.patch(
            "prompt_optimizer.subprocess.run", side_effect=FileNotFoundError()
        ):
            self.assertIsNone(po._run_argv(["x"], 1.0))

    def test_oserror_returns_none(self):
        with mock.patch("prompt_optimizer.subprocess.run", side_effect=OSError()):
            self.assertIsNone(po._run_argv(["x"], 1.0))

    def test_nonzero_returncode_returns_none(self):
        with mock.patch("prompt_optimizer.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess(
                args=[], returncode=1, stdout="x", stderr=""
            )
            self.assertIsNone(po._run_argv(["x"], 1.0))

    def test_empty_output_returns_none(self):
        with mock.patch("prompt_optimizer.subprocess.run") as run:
            run.return_value = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="", stderr=""
            )
            self.assertIsNone(po._run_argv(["x"], 1.0))


class OllamaBaseUrlTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_default(self):
        for k in ("ATLAS_OLLAMA_URL", "OLLAMA_HOST"):
            os.environ.pop(k, None)
        self.assertEqual(po.ollama_base_url(), "http://127.0.0.1:11434")

    def test_atlas_url_wins(self):
        os.environ["ATLAS_OLLAMA_URL"] = "http://host:1234/"
        os.environ.pop("OLLAMA_HOST", None)
        self.assertEqual(po.ollama_base_url(), "http://host:1234")

    def test_ollama_host_fallback(self):
        os.environ.pop("ATLAS_OLLAMA_URL", None)
        os.environ["OLLAMA_HOST"] = "127.0.0.1:5555"
        self.assertEqual(po.ollama_base_url(), "http://127.0.0.1:5555")

    def test_bare_host_gets_scheme(self):
        os.environ["ATLAS_OLLAMA_URL"] = "host:1234"
        self.assertEqual(po.ollama_base_url(), "http://host:1234")


class RunViaApiTest(unittest.TestCase):
    def test_success(self):
        resp = {"response": "optimized spec\n"}
        with mock.patch("prompt_optimizer.urllib.request.urlopen") as urlopen:
            cm = mock.MagicMock()
            cm.__enter__.return_value.read.return_value = json.dumps(resp).encode()
            cm.__exit__.return_value = False
            urlopen.return_value = cm
            self.assertEqual(po.run_via_api("p", "m", 10.0), "optimized spec")

    def test_urlerror_returns_none(self):
        import urllib.error

        with mock.patch(
            "prompt_optimizer.urllib.request.urlopen",
            side_effect=urllib.error.URLError("x"),
        ):
            self.assertIsNone(po.run_via_api("p", "m", 10.0))

    def test_oserror_returns_none(self):
        with mock.patch(
            "prompt_optimizer.urllib.request.urlopen", side_effect=OSError()
        ):
            self.assertIsNone(po.run_via_api("p", "m", 10.0))

    def test_valueerror_returns_none(self):
        with mock.patch("prompt_optimizer.urllib.request.urlopen") as urlopen:
            cm = mock.MagicMock()
            cm.__enter__.return_value.read.return_value = b"not json"
            cm.__exit__.return_value = False
            urlopen.return_value = cm
            self.assertIsNone(po.run_via_api("p", "m", 10.0))

    def test_empty_response_returns_none(self):
        with mock.patch("prompt_optimizer.urllib.request.urlopen") as urlopen:
            cm = mock.MagicMock()
            cm.__enter__.return_value.read.return_value = json.dumps(
                {"response": ""}
            ).encode()
            cm.__exit__.return_value = False
            urlopen.return_value = cm
            self.assertIsNone(po.run_via_api("p", "m", 10.0))

    def test_timeout_returns_none(self):
        with mock.patch(
            "prompt_optimizer.urllib.request.urlopen", side_effect=TimeoutError()
        ):
            self.assertIsNone(po.run_via_api("p", "m", 10.0))


class RunOptimizerTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop("ATLAS_OPTIMIZE_CMD", None)
        os.environ.pop("ATLAS_OPTIMIZER_MODEL", None)
        os.environ.pop("ATLAS_OPTIMIZE_TIMEOUT", None)

    def tearDown(self):
        self.env.stop()

    def test_override_used(self):
        os.environ["ATLAS_OPTIMIZE_CMD"] = "echo {prompt}"
        with mock.patch("prompt_optimizer._run_argv", return_value="X") as ra:
            self.assertEqual(po.run_optimizer("p"), "X")
            self.assertEqual(ra.call_args[0][0], ["echo", "p"])

    def test_api_path_success(self):
        with (
            mock.patch("prompt_optimizer.run_via_api", return_value="api out") as api,
            mock.patch("prompt_optimizer.shutil.which", return_value="/usr/bin/ollama"),
        ):
            self.assertEqual(po.run_optimizer("p"), "api out")
            api.assert_called_once()

    def test_api_fails_cli_fallback_present(self):
        with (
            mock.patch("prompt_optimizer.run_via_api", return_value=None),
            mock.patch("prompt_optimizer.shutil.which", return_value="/usr/bin/ollama"),
            mock.patch("prompt_optimizer._run_argv", return_value="cli out") as ra,
        ):
            self.assertEqual(po.run_optimizer("p"), "cli out")
            self.assertEqual(ra.call_args[0][0][0], "ollama")

    def test_api_fails_no_cli(self):
        with (
            mock.patch("prompt_optimizer.run_via_api", return_value=None),
            mock.patch("prompt_optimizer.shutil.which", return_value=None),
        ):
            self.assertIsNone(po.run_optimizer("p"))

    def test_api_returns_empty_then_cli(self):
        with (
            mock.patch("prompt_optimizer.run_via_api", return_value=None),
            mock.patch("prompt_optimizer.shutil.which", return_value="/usr/bin/ollama"),
            mock.patch("prompt_optimizer._run_argv", return_value=None),
        ):
            self.assertIsNone(po.run_optimizer("p"))


class LooksSubstantiveTest(unittest.TestCase):
    def test_short_prompt_trivial(self):
        self.assertFalse(po.looks_substantive("hi there"))

    def test_trivial_ack(self):
        self.assertFalse(po.looks_substantive("thank you very much indeed"))

    def test_error_signal(self):
        self.assertTrue(po.looks_substantive("Traceback (most recent call last): boom"))

    def test_strong_engineering_verb(self):
        self.assertTrue(
            po.looks_substantive("please refactor the authentication module thoroughly")
        )

    def test_common_verb_with_code_anchor(self):
        self.assertTrue(
            po.looks_substantive("fix the bug in src/app/main.py and add a test")
        )

    def test_common_verb_without_code_anchor(self):
        self.assertFalse(
            po.looks_substantive("fix the sandwich and add some basil to it please")
        )

    def test_neither_verb_nor_code(self):
        self.assertFalse(
            po.looks_substantive("the weather is nice today and the dog is happy")
        )


class ArmOrchestrationTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.tmp = tempfile.mkdtemp()
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")

    def tearDown(self):
        self.env.stop()

    def test_disabled(self):
        os.environ["ATLAS_ENGINE_ARM"] = "off"
        self.assertIsNone(
            po.arm_orchestration({"session_id": "s"}, "refactor the db module now")
        )

    def test_slash_command(self):
        self.assertIsNone(
            po.arm_orchestration({"session_id": "s"}, "/refactor everything here")
        )

    def test_trivial_prompt(self):
        self.assertIsNone(po.arm_orchestration({"session_id": "s"}, "ok"))

    def test_no_session(self):
        self.assertIsNone(po.arm_orchestration({}, "refactor the db module now please"))
        # also empty session
        self.assertIsNone(
            po.arm_orchestration(
                {"session_id": ""}, "refactor the db module now please"
            )
        )

    def test_substantive_arms_and_nudges(self):
        nudge = po.arm_orchestration(
            {"session_id": "s1", "cwd": self.tmp}, "refactor the db module now please"
        )
        self.assertEqual(nudge, po.ENGINE_NUDGE)

    def test_db_failure_fail_open(self):
        with mock.patch("prompt_optimizer.atlas_db", create=True, side_effect=None):
            # Force import inside arm_orchestration to fail by making the path insert fail.
            with mock.patch("builtins.__import__", side_effect=ImportError("nope")):
                # __import__ patching is too broad; instead force atlas_db.connect to raise
                pass
        # Simpler: make connect raise after import via sys.modules replacement.
        fake = mock.MagicMock()
        fake.connect.side_effect = Exception("db down")
        with mock.patch.dict(sys.modules, {"atlas_db": fake}):
            self.assertIsNone(
                po.arm_orchestration(
                    {"session_id": "s1"}, "refactor the db module now please"
                )
            )


class FramingEmitSkipTest(unittest.TestCase):
    def test_framing_contains_spec(self):
        out = po.optimizer_framing("MY SPEC")
        self.assertIn("MY SPEC", out)
        self.assertIn("OPTIMIZED SPEC", out)

    def test_emit_context_prints_json(self):
        with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
            po.emit_context("block1", "block2")
            data = json.loads(out.getvalue())
            self.assertEqual(
                data["hookSpecificOutput"]["additionalContext"], "block1\n\nblock2"
            )

    def test_emit_context_skips_empty(self):
        with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
            po.emit_context("", "", "")
            self.assertEqual(out.getvalue(), "")

    def test_is_skip_empty(self):
        self.assertTrue(po.is_skip(""))
        self.assertTrue(po.is_skip("   \n  "))

    def test_is_skip_token(self):
        self.assertTrue(po.is_skip("SKIP"))
        self.assertTrue(po.is_skip("skip."))
        self.assertTrue(po.is_skip("\nSKIP\n"))

    def test_not_skip(self):
        self.assertFalse(po.is_skip("## Intent\ndo work"))


class NotifyTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop("ATLAS_OPTIMIZE_QUIET", None)

    def tearDown(self):
        self.env.stop()

    def test_quiet_silent(self):
        os.environ["ATLAS_OPTIMIZE_QUIET"] = "1"
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            po.notify("spec text")
            self.assertEqual(err.getvalue(), "")

    def test_banner_without_intent(self):
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            po.notify("just a plain spec with no intent header")
            self.assertIn("prompt-optimizer", err.getvalue())

    def test_banner_with_intent(self):
        spec = "## Intent\nDo the thing\n## Steps\n1. x"
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            po.notify(spec)
            self.assertIn("Do the thing", err.getvalue())

    def test_intent_truncated(self):
        spec = "## Intent\n" + "a" * 200
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            po.notify(spec)
            self.assertIn("...", err.getvalue())


class AuditTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop("ATLAS_OPTIMIZE_LOG", None)

    def tearDown(self):
        self.env.stop()

    def test_no_path_noop(self):
        po.audit("orig", "opt")  # no exception

    def test_writes_log(self):
        fd, path = tempfile.mkstemp()
        os.close(fd)
        os.environ["ATLAS_OPTIMIZE_LOG"] = path
        po.audit("orig prompt", "opt spec")
        with open(path) as fh:
            content = fh.read()
        self.assertIn("ORIGINAL: orig prompt", content)
        self.assertIn("OPTIMIZED:", content)
        self.assertIn("[OK]", content)
        os.unlink(path)

    def test_writes_fail_status(self):
        fd, path = tempfile.mkstemp()
        os.close(fd)
        os.environ["ATLAS_OPTIMIZE_LOG"] = path
        po.audit("orig prompt", None)
        with open(path) as fh:
            content = fh.read()
        self.assertIn("[SKIP/FAIL]", content)
        os.unlink(path)

    def test_oserror_swallowed(self):
        os.environ["ATLAS_OPTIMIZE_LOG"] = "/nonexistent/dir/that/cannot/exist/log.txt"
        po.audit("orig", "opt")  # no exception


class MainTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.tmp = tempfile.mkdtemp()
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")
        for k in (
            "ATLAS_OPTIMIZE",
            "ATLAS_OPTIMIZE_TRIGGER",
            "ATLAS_OPTIMIZE_MINLEN",
            "ATLAS_OPTIMIZE_CMD",
            "ATLAS_OPTIMIZER_MODEL",
            "ATLAS_OPTIMIZE_QUIET",
            "ATLAS_OPTIMIZE_LOG",
            "ATLAS_ENGINE_ARM",
        ):
            os.environ.pop(k, None)
        os.environ["ATLAS_ENGINE_ARM"] = "off"  # keep main() off the DB path by default

    def tearDown(self):
        self.env.stop()

    def _run(self, payload):
        with mock.patch(
            "sys.stdin", new=_stdin(payload) if payload is not None else io.StringIO("")
        ):
            with mock.patch("sys.stdout", new_callable=io.StringIO):
                with mock.patch("sys.stderr", new_callable=io.StringIO):
                    return po.main()

    def test_malformed_json_passthrough(self):
        with mock.patch("sys.stdin", new=io.StringIO("not json")):
            self.assertEqual(po.main(), 0)

    def test_empty_input(self):
        with mock.patch("sys.stdin", new=io.StringIO("")):
            self.assertEqual(po.main(), 0)

    def test_empty_prompt(self):
        self.assertEqual(self._run({"prompt": ""}), 0)

    def test_no_optimize_passthrough(self):
        # no trigger, no optimize -> nothing emitted, exit 0
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        self.assertEqual(self._run({"prompt": "just chatting with no prefix"}), 0)

    def test_optimize_path_emits_context(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        with mock.patch(
            "prompt_optimizer.run_optimizer", return_value="## Intent\nDo work\n"
        ):
            with mock.patch(
                "sys.stdin", new=_stdin({"prompt": "opt: build the feature end to end"})
            ):
                with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                    with mock.patch("sys.stderr", new_callable=io.StringIO):
                        self.assertEqual(po.main(), 0)
                    data = json.loads(out.getvalue())
                    self.assertIn(
                        "OPTIMIZED SPEC",
                        data["hookSpecificOutput"]["additionalContext"],
                    )

    def test_skip_result_passthrough(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        with mock.patch("prompt_optimizer.run_optimizer", return_value="SKIP"):
            with mock.patch(
                "sys.stdin", new=_stdin({"prompt": "opt: build the feature end to end"})
            ):
                with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                    with mock.patch("sys.stderr", new_callable=io.StringIO):
                        po.main()
                    # nothing emitted (skip + no nudge)
                    self.assertEqual(out.getvalue(), "")

    def test_optimizer_returns_none_no_emit(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        with mock.patch("prompt_optimizer.run_optimizer", return_value=None):
            with mock.patch(
                "sys.stdin", new=_stdin({"prompt": "opt: build the feature end to end"})
            ):
                with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                    with mock.patch("sys.stderr", new_callable=io.StringIO):
                        po.main()
                    self.assertEqual(out.getvalue(), "")

    def test_optimize_with_engine_nudge_combines(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        os.environ["ATLAS_ENGINE_ARM"] = "on"
        with (
            mock.patch(
                "prompt_optimizer.run_optimizer", return_value="## Intent\nDo work\n"
            ),
            mock.patch(
                "prompt_optimizer.arm_orchestration", return_value=po.ENGINE_NUDGE
            ),
        ):
            with mock.patch(
                "sys.stdin",
                new=_stdin(
                    {"prompt": "opt: build the feature end to end", "session_id": "s"}
                ),
            ):
                with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                    with mock.patch("sys.stderr", new_callable=io.StringIO):
                        po.main()
                    data = json.loads(out.getvalue())
                    ctx = data["hookSpecificOutput"]["additionalContext"]
                    self.assertIn("OPTIMIZED SPEC", ctx)
                    self.assertIn("atlas-orchestrate", ctx)

    def test_engine_nudge_only_when_no_optimize(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        os.environ["ATLAS_ENGINE_ARM"] = "on"
        with mock.patch(
            "prompt_optimizer.arm_orchestration", return_value=po.ENGINE_NUDGE
        ):
            with mock.patch(
                "sys.stdin",
                new=_stdin(
                    {"prompt": "refactor the db module now please", "session_id": "s"}
                ),
            ):
                with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                    with mock.patch("sys.stderr", new_callable=io.StringIO):
                        po.main()
                    data = json.loads(out.getvalue())
                    self.assertIn(
                        "atlas-orchestrate",
                        data["hookSpecificOutput"]["additionalContext"],
                    )


class EndToEndSubprocessTest(unittest.TestCase):
    """A few real subprocess invocations to confirm exit codes. These do NOT
    contribute to coverage (separate process) but verify the hook's contract."""

    def setUp(self):
        self.env = dict(os.environ, ATLAS_ENGINE_ARM="off", ATLAS_OPTIMIZE="off")

    def test_exit_zero_on_empty_prompt(self):
        r = _run_hook_subprocess({"prompt": ""}, self.env)
        self.assertEqual(r.returncode, 0)

    def test_exit_zero_off_mode(self):
        r = _run_hook_subprocess({"prompt": "opt: do something here"}, self.env)
        self.assertEqual(r.returncode, 0)

    def test_exit_zero_malformed(self):
        env = dict(self.env)
        r = subprocess.run(
            [sys.executable, HOOK],
            input="not json at all",
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
