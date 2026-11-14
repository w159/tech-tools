"""In-process coverage tests for prompt_optimizer.py.

Coverage strategy: import the hook module in-process and drive its real code
paths with mocked stdin (sys.stdin), mocked env (os.environ), and mocked
external calls (subprocess.run, urllib, shutil.which, atlas_db). A few
subprocess end-to-end exit-code tests round it out, but the line coverage
comes from the in-process calls.
"""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
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

    def test_always_mode_is_no_longer_auto_run(self):
        # "always" used to optimize every prompt; the optimizer is opt-in only now.
        os.environ["ATLAS_OPTIMIZE"] = "always"
        do, _ = po.should_optimize("this is a long enough prompt with no trigger")
        self.assertFalse(do)

    def test_always_mode_trigger_still_runs(self):
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

    def test_default_budget_is_shared_and_under_the_hook_cap(self):
        seen = {}

        def api(prompt, model, timeout):
            seen["api"] = timeout
            return None

        with (
            mock.patch("prompt_optimizer.run_via_api", side_effect=api),
            mock.patch("prompt_optimizer.shutil.which", return_value="/usr/bin/ollama"),
            mock.patch("prompt_optimizer._run_argv", return_value=None) as ra,
            mock.patch("prompt_optimizer.time.monotonic", side_effect=[0.0, 20.0]),
        ):
            po.run_optimizer("p")
        self.assertEqual(seen["api"], 25.0)
        self.assertEqual(ra.call_args[0][1], 5.0)  # the API's 20 s came off the budget

    def test_api_timeout_skips_cli_fallback(self):
        with (
            mock.patch(
                "prompt_optimizer.urllib.request.urlopen", side_effect=TimeoutError()
            ),
            mock.patch("prompt_optimizer.shutil.which", return_value="/usr/bin/ollama"),
            mock.patch("prompt_optimizer._run_argv", return_value="cli out") as ra,
        ):
            self.assertIsNone(po.run_optimizer("p"))
        ra.assert_not_called()

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


class ResolveSubstantiveTest(unittest.TestCase):
    def test_strong_verb_does_not_call_model(self):
        called = []

        def decide(prompt):
            called.append(prompt)
            return ("conversation", 0.99)

        self.assertTrue(
            po.resolve_substantive(
                "please refactor the authentication module thoroughly", decide=decide
            )
        )
        self.assertEqual(called, [])

    def test_generic_noun_veto(self):
        text = "add a bow to the table centerpiece before the guests arrive"
        self.assertTrue(po.looks_substantive(text))
        self.assertFalse(
            po.resolve_substantive(text, decide=lambda _p: ("conversation", 0.837))
        )

    def test_low_confidence_keeps_regex_arm(self):
        text = "add a bow to the table centerpiece before the guests arrive"
        self.assertTrue(
            po.resolve_substantive(text, decide=lambda _p: ("conversation", 0.4))
        )

    def test_model_error_keeps_regex_arm(self):
        text = "add a bow to the table centerpiece before the guests arrive"

        def boom(_prompt):
            raise OSError("down")

        self.assertTrue(po.resolve_substantive(text, decide=boom))

    def test_explain_promoted(self):
        text = "explain how the completion gate decides to block a turn"
        self.assertFalse(po.looks_substantive(text))
        self.assertTrue(
            po.resolve_substantive(text, decide=lambda _p: ("investigation", 0.978))
        )

    def test_bare_question_is_not_promoted(self):
        text = "what does this acronym mean"
        self.assertFalse(po.looks_substantive(text))
        self.assertFalse(
            po.resolve_substantive(text, decide=lambda _p: ("investigation", 0.99))
        )

    def test_bare_defect_does_not_promote(self):
        text = "the service is down right now"
        self.assertFalse(po.looks_substantive(text))
        self.assertFalse(
            po.resolve_substantive(text, decide=lambda _p: ("defect", 0.863))
        )

    def test_decision_off_keeps_regex(self):
        text = "explain how the completion gate decides to block a turn"
        with mock.patch.dict(os.environ, {"ATLAS_DECISION": "off"}):
            self.assertFalse(po.resolve_substantive(text))


class IsHarnessEventTest(unittest.TestCase):
    def test_tag_prefixed_event(self):
        self.assertTrue(
            po._is_harness_event(
                "<task-notification>build finished</task-notification>"
            )
        )

    def test_system_reminder(self):
        self.assertTrue(
            po._is_harness_event("<system-reminder>context</system-reminder>")
        )

    def test_handback_report(self):
        self.assertTrue(
            po._is_harness_event(
                "Another Claude session sent a message: "
                '<agent-message from="implementer">[Subagent hand-back] done</agent-message>'
            )
        )

    def test_agent_message_anywhere_in_head(self):
        self.assertTrue(po._is_harness_event('preamble <agent-message from="x">body'))

    def test_genuine_user_prompt_not_harness(self):
        self.assertFalse(
            po._is_harness_event(
                "refactor the auth module and add tests in src/auth.py"
            )
        )

    def test_leading_whitespace_stripped(self):
        self.assertTrue(po._is_harness_event("   <task-notification>x"))

    def test_user_prompt_starting_with_jsx_tag_not_harness(self):
        for text in (
            "<Button> in src/App.tsx throws TypeError when clicked",
            "<div> is not centered in index.html, fix it",
            "<T> generic in utils.ts fails to infer",
        ):
            self.assertFalse(po._is_harness_event(text), text)

    def test_known_harness_tags_match(self):
        for tag in (
            "command-name",
            "local-command-stdout",
            "local-command-caveat",
            "wake",
            "user-prompt-submit-hook",
            "agent-message from=\"x\"",
        ):
            self.assertTrue(po._is_harness_event(f"<{tag}>body"), tag)


class ArmOrchestrationTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.tmp = tempfile.mkdtemp()
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")
        os.environ["ATLAS_DECISION"] = "off"

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
        self.assertTrue(nudge.startswith("[atlas-orchestrate]"))
        self.assertIn("atlas:atlas-orchestrate", nudge)
        self.assertIn("Route implement/", nudge)

    def test_nudge_names_the_skill_and_stays_short(self):
        # Pins the action (skill name, dispatch), not the prose; was 333 chars.
        self.assertIn("atlas:atlas-orchestrate", po.ENGINE_NUDGE)
        self.assertIn("dispatch", po.ENGINE_NUDGE)
        self.assertLess(len(po.ENGINE_NUDGE), 200)

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

    def test_mark_orchestrating_failure_records_friction(self):
        fake_conn = mock.MagicMock()
        fake = mock.MagicMock()
        fake.connect.return_value = fake_conn
        fake.mark_orchestrating.side_effect = Exception("db down")
        calls = []
        kws = []
        fake.record_friction.side_effect = lambda conn, s, cat, **kw: (
            calls.append((conn, s, cat)) or kws.append(kw) or 1
        )
        with (
            mock.patch.dict(sys.modules, {"atlas_db": fake}),
        ):
            self.assertIsNone(
                po.arm_orchestration(
                    {"session_id": "s1", "cwd": self.tmp},
                    "refactor the db module now please",
                )
            )
        self.assertEqual(calls, [(fake_conn, "s1", "orchestration_flag_arm_failed")])
        # arm_orchestration returns early for workers, so this caller is a lead.
        self.assertEqual(kws[0].get("role"), "lead")

    def test_friction_write_failure_still_fail_open(self):
        fake_conn = mock.MagicMock()
        fake = mock.MagicMock()
        fake.connect.return_value = fake_conn
        fake.mark_orchestrating.side_effect = Exception("db down")
        fake.record_friction.side_effect = Exception("db still down")
        with (
            mock.patch.dict(sys.modules, {"atlas_db": fake}),
        ):
            self.assertIsNone(
                po.arm_orchestration(
                    {"session_id": "s1", "cwd": self.tmp},
                    "refactor the db module now please",
                )
            )


class PlainDirNoAtlasTest(unittest.TestCase):
    """A substantive prompt in a directory that is not a project must not create .atlas/."""

    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.tmp = tempfile.mkdtemp()
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")
        os.environ["ATLAS_DECISION"] = "off"
        self.plain = os.path.join(self.tmp, "plain")
        os.makedirs(self.plain)

    def tearDown(self):
        self.env.stop()

    def test_substantive_prompt_creates_no_atlas_dir(self):
        nudge = po.arm_orchestration(
            {"session_id": "plain1", "cwd": self.plain},
            "refactor the db module now please",
        )
        self.assertIsNotNone(nudge)
        self.assertFalse(os.path.exists(os.path.join(self.plain, ".atlas")))

    def test_git_repo_still_gets_scope_and_sentinel(self):
        os.makedirs(os.path.join(self.plain, ".git"))
        po.arm_orchestration(
            {"session_id": "plain2", "cwd": self.plain},
            "refactor the db module now please",
        )
        self.assertTrue(
            os.path.exists(
                os.path.join(self.plain, ".atlas", ".run", "atlas-orchestrate.active")
            )
        )
        self.assertIsNotNone(po.resolved_scope("plain2", self.plain))


class RouteScopeTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, ".git"))  # scope is only stored in a real project
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")
        os.environ["ATLAS_DECISION"] = "off"

    def tearDown(self):
        self.env.stop()

    def _arm(self, sid, prompt):
        return po.arm_orchestration({"session_id": sid, "cwd": self.tmp}, prompt)

    def test_multi_file_build_routes_to_crew(self):
        nudge = self._arm(
            "m1",
            "build the export flow across plugins/atlas/hooks/a.py, "
            "plugins/atlas/scripts/b.py and plugins/atlas/mod/c.ts",
        )
        self.assertNotIn("<", nudge)  # no placeholder command: this repo has no spec/dir/check to fill one
        self.assertIn("working seats", nudge)
        self.assertNotIn("${CLAUDE_PLUGIN_ROOT}", nudge)
        self.assertIn("implement/", nudge)
        self.assertLess(len(nudge.encode()), 700)
        scope = po.resolved_scope("m1", self.tmp)
        self.assertEqual(scope["task_class"], "implement")
        self.assertGreaterEqual(scope["working_seats"], 2)
        self.assertEqual(set(scope), {"task_class", "effort", "working_seats"})

    def test_one_symbol_lookup_is_single_in_process(self):
        nudge = self._arm("l1", "investigate how resolve_substantive works")
        self.assertIn("one in-process atlas:explorer call with SCOPE: audit/low", nudge)
        self.assertNotIn("atlas_crew.py", nudge)
        self.assertNotIn("spawn-team", nudge)
        self.assertEqual(
            po.resolved_scope("l1", self.tmp),
            {"task_class": "audit", "effort": "low", "working_seats": 1},
        )

    def test_single_named_file_routes_to_one_worker_not_a_crew(self):
        nudge = self._arm(
            "f1", "refactor src/a.py to add type hints and run the tests"
        )
        self.assertIn("one in-process atlas:", nudge)
        self.assertNotIn("atlas_crew.py", nudge)
        self.assertNotIn("<", nudge)
        self.assertEqual(po.resolved_scope("f1", self.tmp)["working_seats"], 1)

    def test_several_named_files_still_route_to_a_crew(self):
        nudge = self._arm("f2", "refactor src/a.py and src/b.py to add type hints")
        self.assertNotIn("one in-process atlas:", nudge)
        self.assertGreaterEqual(po.resolved_scope("f2", self.tmp)["working_seats"], 2)

    def test_identical_routing_text_is_injected_once_per_session(self):
        prompt = "refactor src/a.py to add type hints and run the tests"
        first = self._arm("rep1", prompt)
        self.assertTrue(first)
        for _ in range(3):
            self.assertIsNone(self._arm("rep1", prompt))
        # the stored scope survives the suppressed repeats (gates still read it)
        self.assertIsNotNone(po.resolved_scope("rep1", self.tmp))
        # another session, and a different route, still get theirs
        self.assertEqual(self._arm("rep2", prompt), first)
        self.assertTrue(self._arm("rep1", "audit every hook across the whole repo for leaks"))

    def test_read_only_team_uses_spawn_team(self):
        nudge = self._arm("r1", "audit every hook across the whole repo for leaks")
        self.assertIn('atlas_mux.py" spawn-team --class audit --effort high', nudge)
        self.assertNotIn("${CLAUDE_PLUGIN_ROOT}", nudge)
        self.assertLess(len(nudge.encode()), 700)

    def test_resolver_exception_keeps_old_nudge(self):
        prompt = "build the export flow across a.py, b.py and c.ts"
        self._arm("e1", prompt)
        self.assertIsNotNone(po.resolved_scope("e1", self.tmp))
        import atlas_resolve

        with mock.patch.object(atlas_resolve, "resolve", side_effect=RuntimeError("x")):
            nudge = self._arm("e1", prompt)
        self.assertEqual(nudge, po.ENGINE_NUDGE)
        self.assertIsNone(po.resolved_scope("e1", self.tmp))

    def test_unarmed_s1_clears_stale_scope(self):
        self._arm("s1", "build the export flow across a.py, b.py and c.ts")
        self.assertIsNotNone(po.resolved_scope("s1", self.tmp))
        self.assertIsNone(self._arm("s1", "ok thanks"))
        self.assertIsNone(po.resolved_scope("s1", self.tmp))

    def test_unarmed_s2_clears_stale_scope(self):
        self._arm("s2", "build the export flow across a.py, b.py and c.ts")
        self.assertIsNotNone(po.resolved_scope("s2", self.tmp))
        self.assertIsNone(self._arm("s2", "/atlas:status"))
        self.assertIsNone(po.resolved_scope("s2", self.tmp))

    def _spec_repo(self):
        root = Path(self.tmp)
        (root / "kit").mkdir()
        (root / "tests").mkdir()
        (root / "docs").mkdir()
        (root / "SPEC.md").write_text("# Kit\n## kit/a.py\nA\n## kit/b.py\nB\n")
        for stem in ("a", "b"):
            (root / "kit" / f"{stem}.py").write_text("def f():\n    raise NotImplementedError\n")
            (root / "tests" / f"test_{stem}.py").write_text("def test_x():\n    pass\n")
        (root / "kit" / "__init__.py").write_text("")
        (root / "docs" / "CHANGELOG.md").write_text("# Changelog\n")
        return root

    PROMPT = (
        "Implement every module in kit/ per SPEC.md so that `python3 -m pytest -q` passes. "
        "Update docs/CHANGELOG.md for the change."
    )

    def test_crew_command_is_exact_and_repo_aware(self):
        self._spec_repo()
        cmd = po.crew_command(self.tmp, self.PROMPT, "sess-9")
        self.assertIn("atlas_crew.py\" run --spec SPEC.md --files 'kit/*.py'", cmd)
        self.assertIn("--tests 'tests/test_{stem}.py'", cmd)
        self.assertIn("--check 'python3 -m pytest -q'", cmd)
        self.assertIn("--session sess-9 --wait 110 --changelog", cmd)
        self.assertTrue(os.path.isfile(cmd.split('"')[1]), cmd)  # the script path is real and absolute
        nudge = self._arm("c1", self.PROMPT)
        self.assertIn("--files 'kit/*.py'", nudge)
        self.assertIn("Don't write those files or read them", nudge)
        self.assertIn("--wait 110 --changelog '<one line: what changed>'`", nudge)
        self.assertIn("don't re-run tests", nudge)
        self.assertLess(len(nudge.encode()), po._CREW_NUDGE_MAX_BYTES)
        self.assertLess(len(nudge.encode()), 700)

    def test_crew_command_none_without_spec_dir_or_check(self):
        root = self._spec_repo()
        self.assertIsNone(po.crew_command(self.tmp, "Implement every module in docs/ per SPEC.md", ""))
        (root / "SPEC.md").unlink()
        self.assertIsNone(po.crew_command(self.tmp, self.PROMPT, ""))
        nudge = self._arm("c2", self.PROMPT)
        self.assertNotIn("<", nudge)  # never a command with placeholders the repo could not fill
        self.assertNotIn("atlas_crew.py\" run", nudge)
        self.assertIn("working seats", nudge)

    def test_every_module_is_high_effort(self):
        self.assertEqual(po.classify_scope("implement every module in kit/")[1], "high")
        self.assertEqual(po.classify_scope("fix all the file headers")[1], "high")

    def test_resolved_scope_missing_or_empty(self):
        self.assertIsNone(po.resolved_scope("nope", self.tmp))
        self.assertIsNone(po.resolved_scope("", self.tmp))

    def test_classify_scope(self):
        self.assertEqual(po.classify_scope("please make it nicer"), ("implement", "medium"))
        self.assertEqual(po.classify_scope("fix the bug in parse_args"), ("fix", "low"))
        self.assertEqual(po.classify_scope("fix the bug in foo.py"), ("fix", "low"))
        multi = po.classify_scope(
            "Refactor backend/services/auth.py to use JWT, fix the failing login "
            "test, and add rate limiting to the API."
        )
        self.assertIn(multi[1], ("medium", "high"))
        self.assertEqual(po.classify_scope("review the whole codebase"), ("audit", "high"))
        self.assertEqual(
            po.classify_scope("update tests in plugins/x/test_a.py and b.py")[0], "test"
        )
        self.assertEqual(
            po.classify_scope("rename foo in plugins/x/test_a.py")[0], "implement"
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
        os.environ.pop("ATLAS_OPTIMIZE_VERBOSE", None)

    def tearDown(self):
        self.env.stop()

    def test_default_is_silent(self):
        """Noise contract: the banner is opt-in, not opt-out."""
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            po.notify("## Intent\nDo the thing")
            self.assertEqual(err.getvalue(), "")

    def test_verbose_banner_without_intent(self):
        os.environ["ATLAS_OPTIMIZE_VERBOSE"] = "1"
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            po.notify("just a plain spec with no intent header")
            self.assertIn("[atlas] spec injected", err.getvalue())

    def test_verbose_banner_with_intent(self):
        os.environ["ATLAS_OPTIMIZE_VERBOSE"] = "1"
        spec = "## Intent\nDo the thing\n## Steps\n1. x"
        with mock.patch("sys.stderr", new_callable=io.StringIO) as err:
            po.notify(spec)
            out = err.getvalue()
            self.assertIn("Do the thing", out)
            self.assertEqual(len(out.strip().splitlines()), 1)  # one line, always

    def test_intent_truncated(self):
        os.environ["ATLAS_OPTIMIZE_VERBOSE"] = "1"
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

    def test_handback_report_no_output_no_arming(self):
        os.environ["ATLAS_OPTIMIZE"] = "always"
        os.environ["ATLAS_ENGINE_ARM"] = "on"
        with mock.patch("prompt_optimizer.arm_orchestration") as arm:
            with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                with mock.patch(
                    "sys.stdin",
                    new=_stdin(
                        {
                            "prompt": (
                                "Another Claude session sent a message: "
                                '<agent-message from="implementer">'
                                "[Subagent hand-back] refactor done, tests pass"
                                "</agent-message>"
                            ),
                            "session_id": "s",
                        }
                    ),
                ):
                    self.assertEqual(po.main(), 0)
            self.assertEqual(out.getvalue(), "")
            arm.assert_not_called()

    def test_task_notification_no_output(self):
        os.environ["ATLAS_OPTIMIZE"] = "always"
        os.environ["ATLAS_ENGINE_ARM"] = "on"
        with mock.patch("prompt_optimizer.arm_orchestration") as arm:
            with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                with mock.patch(
                    "sys.stdin",
                    new=_stdin(
                        {
                            "prompt": "<task-notification>build finished successfully</task-notification>",
                            "session_id": "s",
                        }
                    ),
                ):
                    self.assertEqual(po.main(), 0)
            self.assertEqual(out.getvalue(), "")
            arm.assert_not_called()

    def test_genuine_engineering_prompt_still_arms(self):
        os.environ["ATLAS_OPTIMIZE"] = "trigger"
        os.environ["ATLAS_ENGINE_ARM"] = "on"
        with mock.patch(
            "prompt_optimizer.arm_orchestration", return_value=po.ENGINE_NUDGE
        ) as arm:
            with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                with mock.patch(
                    "sys.stdin",
                    new=_stdin(
                        {
                            "prompt": "refactor the auth module in src/auth.py and add tests",
                            "session_id": "s",
                        }
                    ),
                ):
                    self.assertEqual(po.main(), 0)
            arm.assert_called_once()
            data = json.loads(out.getvalue())
            self.assertIn(
                "atlas-orchestrate", data["hookSpecificOutput"]["additionalContext"]
            )

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


class OptInGateAndDirectiveTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=False)
        self.env.start()
        for k in ("ATLAS_OPTIMIZE_TRIGGER", "ATLAS_OPTIMIZE_MINLEN"):
            os.environ.pop(k, None)
        os.environ["ATLAS_ENGINE_ARM"] = "off"
        os.environ["ATLAS_OPTIMIZE"] = "always"  # the old auto-run setting

    def tearDown(self):
        self.env.stop()

    def _main(self, prompt):
        with mock.patch("prompt_optimizer.run_optimizer", return_value="## Intent\nX") as ro:
            with mock.patch("sys.stdin", new=_stdin({"prompt": prompt})):
                with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
                    with mock.patch("sys.stderr", new_callable=io.StringIO):
                        po.main()
        return ro, out.getvalue()

    def test_no_trigger_no_model_run_no_spec(self):
        ro, out = self._main("please build the whole feature end to end")
        ro.assert_not_called()
        self.assertNotIn("OPTIMIZED SPEC", out)

    def test_trigger_runs_model(self):
        ro, out = self._main("opt: please build the whole feature end to end")
        ro.assert_called_once()
        self.assertIn("OPTIMIZED SPEC", out)

    def test_template_directs_ste_and_does_not_apply_it(self):
        sent = po.build_optimizer_prompt("build the feature")
        self.assertIn("build the feature", sent)
        self.assertIn("ASDSTE-100", sent)
        self.assertIn("about 80%", sent)
        self.assertIn(po.STE_DIRECTIVE, sent)
        # The optimizer carries the directive; it must not be told to write STE itself.
        self.assertIn("Do NOT rewrite the request itself into Simplified Technical English", sent)
        self.assertNotIn("Write your rewrite in", sent)

    def test_main_sends_template_to_model(self):
        ro, _ = self._main("opt: please build the whole feature end to end")
        self.assertIn(po.STE_DIRECTIVE, ro.call_args[0][0])


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

    def test_null_prompt_is_an_empty_prompt_not_a_fault(self):
        env = dict(self.env, HOME=tempfile.mkdtemp())
        r = _run_hook_subprocess({"hook_event_name": "UserPromptSubmit", "prompt": None}, env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn("fail-open", r.stderr)
        self.assertEqual(r.stdout, "")


if __name__ == "__main__":
    unittest.main()
