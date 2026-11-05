"""event_dispatch unit contracts: stream parsing, bucketing, telemetry keys, slice/fault handling,
Codex rewrites and the command-line entry point. Complements test_event_dispatch.py."""

import io
import json
import os
import signal
import sys
import unittest
from unittest import mock

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import event_dispatch as ed  # noqa: E402


def _spec(**kw):
    kw.setdefault("hookEventName", "PreToolUse")
    return json.dumps({"hookSpecificOutput": kw})


class DocsTest(unittest.TestCase):
    def test_empty_and_blank(self):
        self.assertEqual(ed._docs(""), ([], ""))
        self.assertEqual(ed._docs(" \n\t "), ([], ""))

    def test_whitespace_between_documents_is_skipped_not_terminal(self):
        docs, stray = ed._docs('  {"a": 1} \n\n {"b": 2}\t{"c": 3}')
        self.assertEqual(docs, [{"a": 1}, {"b": 2}, {"c": 3}])
        self.assertEqual(stray, "")

    def test_non_json_remainder_is_returned_and_stops_parsing(self):
        docs, stray = ed._docs('{"a": 1} oops {"b": 2}')
        self.assertEqual(docs, [{"a": 1}])
        self.assertEqual(stray, 'oops {"b": 2}')

    def test_non_dict_json_values_are_skipped_but_parsing_continues(self):
        docs, stray = ed._docs('[1, 2] 7 "s" {"a": 1}')
        self.assertEqual(docs, [{"a": 1}])
        self.assertEqual(stray, "")

    def test_plain_text_only(self):
        self.assertEqual(ed._docs("  hello \n"), ([], "hello"))


class MatchesTest(unittest.TestCase):
    def test_wildcards(self):
        for m in (None, "", "*"):
            self.assertTrue(ed.matches(m, "Anything"))
            self.assertTrue(ed.matches(m, None))

    def test_full_match_only(self):
        self.assertTrue(ed.matches("Edit|edit", "edit"))
        self.assertFalse(ed.matches("Edit", "MultiEdit"))
        self.assertFalse(ed.matches("Edit", "EditX"))
        self.assertTrue(ed.matches("mcp__.*ctx_read", "mcp__lean-ctx__ctx_read"))

    def test_none_tool_matches_only_wildcards(self):
        self.assertFalse(ed.matches("Bash", None))
        self.assertFalse(ed.matches("Bash", ""))


class BucketTest(unittest.TestCase):
    def test_boundaries(self):
        cases = [
            (0, "lt50"),
            (49.99, "lt50"),
            (50, "50to200"),
            (199.99, "50to200"),
            (200, "200to1000"),
            (999.99, "200to1000"),
            (1000, "ge1000"),
            (60000, "ge1000"),
        ]
        for ms, want in cases:
            self.assertEqual(ed._bucket(ms), want, ms)


class PromptSkillKeyTest(unittest.TestCase):
    def test_real_skill_forms(self):
        for p in (
            "/atlas:atlas-ship",
            "/atlas-ship",
            "  /atlas-ship now",
            "\n/atlas:atlas-ship\n",
        ):
            self.assertEqual(ed.prompt_skill_key(p), "skill.atlas-ship", p)

    def test_non_skill_directory_is_dropped(self):
        self.assertIsNone(ed.prompt_skill_key("/atlas-does-not-exist"))
        self.assertIsNone(ed.prompt_skill_key("/atlas:atlas-nope args"))

    def test_longer_name_is_not_a_prefix_match(self):
        self.assertIsNone(ed.prompt_skill_key("/atlas-shipx"))
        self.assertIsNone(ed.prompt_skill_key("/atlas-ship.md"))

    def test_must_start_with_slash_command(self):
        for p in ("hello", "run /atlas-ship", "atlas-ship", "", "/", "/other-skill"):
            self.assertIsNone(ed.prompt_skill_key(p), p)

    def test_non_string(self):
        for p in (None, 5, ["/atlas-ship"], {"prompt": "/atlas-ship"}):
            self.assertIsNone(ed.prompt_skill_key(p))

    def test_leading_whitespace_of_any_length_and_trailing_text_are_ignored(self):
        self.assertEqual(ed.prompt_skill_key(" " * 500 + "/atlas-ship" + " x" * 500), "skill.atlas-ship")


class RecordPromptTest(unittest.TestCase):
    def _hot(self):
        hot = mock.MagicMock()
        return hot, mock.patch.dict(sys.modules, {"atlas_analytics_hot": hot})

    def test_records_leading_atlas_slash_command(self):
        hot, ctx = self._hot()
        with ctx:
            ed.record_prompt({"prompt": "/atlas:atlas-ship please"})
        hot.record.assert_called_once_with(["skill.atlas-ship"])

    def test_ignores_everything_else(self):
        hot, ctx = self._hot()
        with ctx:
            for payload in (
                {"prompt": "just chat"},
                {"prompt": "/atlas-ghost"},
                {"prompt": 7},
                {},
                None,
                "/atlas-ship",
                ["/atlas-ship"],
            ):
                ed.record_prompt(payload)
        hot.record.assert_not_called()

    def test_never_raises(self):
        hot, ctx = self._hot()
        hot.record.side_effect = RuntimeError("disk full")
        with ctx:
            self.assertIsNone(ed.record_prompt({"prompt": "/atlas-ship"}))


class RecordAnalyticsTest(unittest.TestCase):
    def _run(self, *args, **kw):
        hot, full = mock.MagicMock(), mock.MagicMock()
        with mock.patch.dict(
            sys.modules, {"atlas_analytics_hot": hot, "atlas_analytics": full}
        ):
            ed._record_analytics(*args, **kw)
        return hot, full

    def test_trusted_keys_order_slow_fault_then_latency(self):
        hot, full = self._run("PreToolUse", {}, [], 12.0, slow=["a", "b"], faults=["c"])
        hot.record.assert_called_once_with(
            [
                "hook.a.slow",
                "hook.b.slow",
                "hook.c.fault",
                "dispatch.PreToolUse.ms.lt50",
            ]
        )
        full.record.assert_not_called()

    def test_latency_bucket_in_key(self):
        hot, _ = self._run("PostToolUse", {}, [], 250.0)
        hot.record.assert_called_once_with(["dispatch.PostToolUse.ms.200to1000"])

    def test_no_elapsed_no_latency_key(self):
        hot, full = self._run("PreToolUse", {}, [])
        hot.record.assert_not_called()
        full.record.assert_not_called()

    def test_zero_elapsed_still_recorded(self):
        hot, _ = self._run("PreToolUse", {}, [], 0.0)
        hot.record.assert_called_once_with(["dispatch.PreToolUse.ms.lt50"])

    def test_validated_keys_go_through_full_client_one_by_one(self):
        results = [("a", 2, "", ""), ("b", 0, _spec(additionalContext="x"), "")]
        hot, full = self._run("PreToolUse", {}, results)
        hot.record.assert_not_called()
        self.assertEqual(
            [c.args for c in full.record.call_args_list],
            [("hook.a.deny",), ("hook.b.context",)],
        )

    def test_both_paths_in_one_dispatch(self):
        results = [("a", 2, "", "")]
        hot, full = self._run("PreToolUse", {}, results, 1.0, faults=["z"])
        hot.record.assert_called_once_with(
            ["hook.z.fault", "dispatch.PreToolUse.ms.lt50"]
        )
        full.record.assert_called_once_with("hook.a.deny")

    def test_never_raises(self):
        hot = mock.MagicMock()
        hot.record.side_effect = OSError("ro fs")
        with mock.patch.dict(sys.modules, {"atlas_analytics_hot": hot}):
            self.assertIsNone(ed._record_analytics("PreToolUse", {}, [], 1.0))


class AnalyticsKeysTest(unittest.TestCase):
    def test_hook_without_output_or_decision_adds_nothing(self):
        results = [
            ("a", 0, "", ""),
            ("b", 0, _spec(permissionDecision="allow"), ""),
            ("c", 0, _spec(additionalContext="   "), ""),
            ("d", 0, "[1]", ""),
            ("e", 1, "plain text", ""),
        ]
        self.assertEqual(ed._analytics_keys("PreToolUse", {}, results), [])

    def test_deny_ask_and_context_in_one_document(self):
        out = _spec(permissionDecision="ask", additionalContext="note")
        self.assertEqual(
            ed._analytics_keys("PreToolUse", {}, [("h", 0, out, "")]),
            ["hook.h.ask", "hook.h.context"],
        )

    def test_exit_two_is_deny_and_skips_output(self):
        out = _spec(additionalContext="ignored")
        self.assertEqual(
            ed._analytics_keys("PreToolUse", {}, [("h", 2, out, "")]), ["hook.h.deny"]
        )

    def test_skill_and_agent_names_need_a_real_suffix(self):
        def keys(tool, ti):
            return ed._analytics_keys(
                "PostToolUse", {"tool_name": tool, "tool_input": ti}, []
            )

        self.assertEqual(keys("Skill", {"skill": "atlas:x"}), ["skill.x"])
        self.assertEqual(keys("Skill", {"skill": "atlas:"}), [])
        self.assertEqual(keys("Skill", {"skill": "atlas"}), [])
        self.assertEqual(keys("Skill", {"skill": 3}), [])
        self.assertEqual(keys("Agent", {"subagent_type": "atlas:y"}), ["agent.y"])
        self.assertEqual(keys("Task", {"subagent_type": "atlas:y"}), ["agent.y"])
        self.assertEqual(keys("Task", {"subagent_type": "atlas:"}), [])
        self.assertEqual(keys("Task", {"subagent_type": None}), [])
        self.assertEqual(
            keys("Bash", {"skill": "atlas:x", "subagent_type": "atlas:y"}), []
        )
        self.assertEqual(keys("Skill", None), [])


class InvokeTest(unittest.TestCase):
    def setUp(self):
        self.faults = []
        p = mock.patch.object(ed, "_FAULTS", self.faults)
        p.start()
        self.addCleanup(p.stop)
        f = mock.patch.object(ed, "_fault")
        self.fault = f.start()
        self.addCleanup(f.stop)

    def _run(self, fn, seconds=5, cwd=None):
        with mock.patch.object(ed, "_resolve", lambda name: fn):
            return ed._invoke("h", '{"x": 1}', seconds, cwd)

    def test_exit_codes_zero_and_two_are_not_faults(self):
        self.assertEqual(self._run(lambda: 0)[0], 0)
        self.assertEqual(self._run(lambda: 2)[0], 2)
        self.assertEqual(self.faults, [])

    def test_other_exit_codes_are_reported_and_faulted(self):
        for code in (1, 3, 127):
            self.faults.clear()
            self.assertEqual(self._run(lambda c=code: c)[0], code)
            self.assertEqual(self.faults, ["h"], code)

    def test_non_int_return_is_zero(self):
        self.assertEqual(self._run(lambda: "boom")[0], 0)
        self.assertEqual(self._run(lambda: None)[0], 0)
        self.assertEqual(self.faults, [])

    def test_system_exit_code_mapping(self):
        def bail(code):
            def fn():
                sys.exit(code)

            return fn

        self.assertEqual(self._run(bail(None))[0], 0)
        self.assertEqual(self._run(bail(2))[0], 2)
        self.assertEqual(self.faults, [])
        self.assertEqual(self._run(bail("msg"))[0], 1)
        self.assertEqual(self.faults, ["h"])

    def test_raise_returns_stderr_so_far_and_records_fault(self):
        def boom():
            sys.stderr.write("trace\n")
            raise ValueError("bad")

        rc, out, err = self._run(boom, cwd="/proj")
        self.assertEqual((rc, out, err), (0, "", "trace\n"))
        self.assertEqual(self.faults, ["h"])
        name, exc, cwd = self.fault.call_args.args
        self.assertEqual((name, type(exc), cwd), ("h", ValueError, "/proj"))

    def test_streams_and_stdin_are_captured_and_restored(self):
        seen = {}

        def fn():
            seen["stdin"] = sys.stdin.read()
            print("out")
            sys.stderr.write("err")
            return 0

        before = (sys.stdin, sys.stdout, sys.stderr)
        self.assertEqual(self._run(fn), (0, "out\n", "err"))
        self.assertEqual(seen["stdin"], '{"x": 1}')
        self.assertEqual((sys.stdin, sys.stdout, sys.stderr), before)

    @unittest.skipUnless(hasattr(signal, "SIGALRM"), "needs SIGALRM")
    def test_timer_is_cleared_and_handler_restored(self):
        prev = signal.getsignal(signal.SIGALRM)
        self._run(lambda: 0, seconds=30)
        self.assertEqual(signal.getsignal(signal.SIGALRM), prev)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    @unittest.skipUnless(hasattr(signal, "SIGALRM"), "needs SIGALRM")
    def test_zero_seconds_means_unbounded_no_timer(self):
        seen = {}

        def fn():
            seen["timer"] = signal.getitimer(signal.ITIMER_REAL)[0]
            return 0

        self._run(fn, seconds=0)
        self.assertEqual(seen["timer"], 0)

    @unittest.skipUnless(hasattr(signal, "SIGALRM"), "needs SIGALRM")
    def test_bounded_run_arms_the_timer(self):
        seen = {}

        def fn():
            seen["timer"] = signal.getitimer(signal.ITIMER_REAL)[0]
            return 0

        self._run(fn, seconds=30)
        self.assertGreater(seen["timer"], 0)

    @unittest.skipUnless(hasattr(signal, "SIGALRM"), "needs SIGALRM")
    def test_expired_slice_fails_open_and_swallows_hook_except_blocks(self):
        import time

        def stubborn():
            try:
                time.sleep(5)
            except Exception:
                return 0

        rc, out, err = self._run(stubborn, seconds=0.2, cwd="/p")
        self.assertEqual((rc, out, err), (0, "", ""))
        self.assertEqual(self.faults, ["h"])
        name, exc, cwd = self.fault.call_args.args
        self.assertEqual((name, type(exc), cwd), ("h", TimeoutError, "/p"))

    def test_outside_a_dispatch_faults_are_not_tracked(self):
        with mock.patch.object(ed, "_FAULTS", None):
            self.assertEqual(self._run(lambda: 1)[0], 1)

            def boom():
                raise RuntimeError

            self.assertEqual(self._run(boom)[0], 0)
        self.assertEqual(self.faults, [])


class AlarmAndFaultTest(unittest.TestCase):
    def test_on_alarm_raises_a_baseexception_not_an_exception(self):
        with self.assertRaises(ed._SliceExpired):
            ed._on_alarm(signal.SIGALRM if hasattr(signal, "SIGALRM") else 14, None)
        self.assertTrue(issubclass(ed._SliceExpired, BaseException))
        self.assertFalse(issubclass(ed._SliceExpired, Exception))

    def test_fault_forwards_to_hook_guard(self):
        guard = mock.MagicMock()
        err = RuntimeError("x")
        with mock.patch.dict(sys.modules, {"atlas_hook_guard": guard}):
            ed._fault("name", err, "/cwd")
        guard.fault.assert_called_once_with("name", err, "/cwd")

    def test_fault_cwd_defaults_to_none(self):
        guard = mock.MagicMock()
        with mock.patch.dict(sys.modules, {"atlas_hook_guard": guard}):
            ed._fault("name", RuntimeError("x"))
        guard.fault.assert_called_once_with("name", mock.ANY, None)

    def test_fault_never_raises(self):
        guard = mock.MagicMock()
        guard.fault.side_effect = OSError("no disk")
        with mock.patch.dict(sys.modules, {"atlas_hook_guard": guard}):
            self.assertIsNone(ed._fault("name", RuntimeError("x")))


class ResolveTest(unittest.TestCase):
    def test_resolves_plain_name_and_remapped_name(self):
        self.assertIs(
            ed._resolve("edit_read_nudge"), __import__("edit_read_nudge").main
        )
        self.assertIs(
            ed._resolve("dispatch_tripwire"), __import__("dispatch_tripwire_core").main
        )


class SelectAndMatcherTest(unittest.TestCase):
    def test_unknown_event_selects_nothing(self):
        self.assertEqual(ed.select("Nope", "Bash", "claude"), [])

    def test_select_reads_harness_from_env_when_not_given(self):
        with mock.patch.dict(os.environ, {"ATLAS_HARNESS": "omp"}):
            self.assertNotIn("recall_gate", ed.select("PreToolUse", "Bash"))
        with mock.patch.dict(os.environ, {"ATLAS_HARNESS": "claude"}):
            self.assertIn("recall_gate", ed.select("PreToolUse", "Bash"))

    def test_explicit_harness_beats_env(self):
        with mock.patch.dict(os.environ, {"ATLAS_HARNESS": "omp"}):
            self.assertIn("recall_gate", ed.select("PreToolUse", "Bash", "claude"))

    def test_outer_matcher_dedupes_in_first_seen_order(self):
        table = (("a", "Edit|Write", 1), ("b", "Write|Bash", 1), ("c", "Edit", 1))
        with mock.patch.dict(ed.BINDINGS, {"X": table}):
            self.assertEqual(ed.outer_matcher("X"), "Edit|Write|Bash")

    def test_outer_matcher_star_wins(self):
        table = (("a", "Edit", 1), ("b", "*", 1))
        with mock.patch.dict(ed.BINDINGS, {"X": table}):
            self.assertEqual(ed.outer_matcher("X"), "*")


class RunEventEdgeTest(unittest.TestCase):
    def test_exhausted_budget_skips_hooks_and_records_faults(self):
        ran = []
        fakes = {"a": lambda: ran.append("a") or 0, "b": lambda: ran.append("b") or 0}
        with (
            mock.patch.object(ed, "_fault") as fault,
            mock.patch.dict(
                ed.BINDINGS, {"PreToolUse": (("a", "*", 5), ("b", "*", 5))}
            ),
            mock.patch.dict(ed.BUDGET_S, {"PreToolUse": 0.4}),
            mock.patch.object(ed, "_resolve", lambda name: fakes[name]),
            mock.patch.dict(
                sys.modules, {"atlas_analytics_hot": mock.MagicMock()}
            ) as _,
        ):
            hot = sys.modules["atlas_analytics_hot"]
            out = ed.run_event("PreToolUse", '{"tool_name": "Bash"}', harness="claude")
        self.assertEqual(ran, [])
        self.assertEqual(out, (0, "", ""))
        self.assertEqual([c.args[0] for c in fault.call_args_list], ["a", "b"])
        self.assertIsInstance(fault.call_args_list[0].args[1], TimeoutError)
        recorded = hot.record.call_args.args[0]
        self.assertEqual(recorded[:2], ["hook.a.fault", "hook.b.fault"])

    def test_slow_hook_is_recorded(self):
        with (
            mock.patch.object(ed, "SLOW_HOOK_MS", -1),
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": (("a", "*", 5),)}),
            mock.patch.object(ed, "_resolve", lambda name: lambda: 0),
            mock.patch.dict(sys.modules, {"atlas_analytics_hot": mock.MagicMock()}),
        ):
            ed.run_event("PreToolUse", '{"tool_name": "Bash"}', harness="claude")
            keys = sys.modules["atlas_analytics_hot"].record.call_args.args[0]
        self.assertEqual(keys[0], "hook.a.slow")

    def test_fast_hook_is_not_slow(self):
        with (
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": (("a", "*", 5),)}),
            mock.patch.object(ed, "_resolve", lambda name: lambda: 0),
            mock.patch.dict(sys.modules, {"atlas_analytics_hot": mock.MagicMock()}),
        ):
            ed.run_event("PreToolUse", '{"tool_name": "Bash"}', harness="claude")
            keys = sys.modules["atlas_analytics_hot"].record.call_args.args[0]
        self.assertEqual([k for k in keys if k.endswith(".slow")], [])

    def test_fault_state_is_reset_after_a_dispatch(self):
        with (
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": (("a", "*", 5),)}),
            mock.patch.object(ed, "_resolve", lambda name: lambda: 0),
        ):
            ed.run_event("PreToolUse", "{}", harness="claude")
        self.assertIsNone(ed._FAULTS)

    def test_exit_two_from_a_hook_blocks_the_dispatch(self):
        def blocker():
            sys.stderr.write("stop\n")
            return 2

        with (
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": (("a", "*", 5),)}),
            mock.patch.object(ed, "_resolve", lambda name: blocker),
        ):
            self.assertEqual(
                ed.run_event("PreToolUse", "{}", harness="claude"), (2, "", "stop\n")
            )

    def test_non_dict_json_payload_is_treated_as_empty(self):
        seen = []
        with (
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": (("a", "*", 5),)}),
            mock.patch.object(
                ed, "_resolve", lambda name: lambda: seen.append(sys.stdin.read()) or 0
            ),
        ):
            ed.run_event("PreToolUse", "[1, 2]", harness="claude")
            ed.run_event("PreToolUse", "   ", harness="claude")
        self.assertEqual(seen, ["[1, 2]", "   "])

    def test_hook_receives_raw_payload_for_untranslated_tools(self):
        raw = '{"tool_name":  "Bash",   "cwd": "/x"}'
        seen = []
        with (
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": (("a", "*", 5),)}),
            mock.patch.object(
                ed, "_resolve", lambda name: lambda: seen.append(sys.stdin.read()) or 0
            ),
        ):
            ed.run_event("PreToolUse", raw, harness="claude")
        self.assertEqual(seen, [raw])

    def test_unknown_event_runs_no_hooks_and_uses_default_budget(self):
        self.assertEqual(
            ed.run_event("Mystery", '{"tool_name": "Bash"}', harness="claude"),
            (0, "", ""),
        )

    def test_codex_apply_patch_runs_hooks_per_file_and_drops_updated_input(self):
        patch_text = (
            "*** Begin Patch\n*** Update File: a.py\n@@\n-x\n+y\n"
            "*** Update File: b.py\n@@\n-p\n+q\n*** End Patch"
        )
        payload = {
            "tool_name": "apply_patch",
            "cwd": "/w",
            "tool_input": {"command": patch_text},
        }
        seen = []

        def hook():
            doc = json.loads(sys.stdin.read())
            seen.append((doc["tool_name"], doc["tool_input"]["file_path"]))
            print(
                _spec(
                    updatedInput={"file_path": "x"}, additionalContext="c%d" % len(seen)
                )
            )
            return 0

        with (
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": (("a", "*", 5),)}),
            mock.patch.object(ed, "_resolve", lambda name: hook),
        ):
            code, out, _ = ed.run_event(
                "PreToolUse", json.dumps(payload), harness="codex"
            )
        self.assertEqual(seen, [("Edit", "/w/a.py"), ("Edit", "/w/b.py")])
        spec = json.loads(out)["hookSpecificOutput"]
        self.assertNotIn("updatedInput", spec)
        self.assertEqual(spec["additionalContext"], "c1\n\nc2")


class CodexSafeTest(unittest.TestCase):
    ASK = json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": "why",
                "updatedInput": {"a": 1},
            }
        }
    )

    def test_ask_becomes_deny_under_codex(self):
        with mock.patch.dict(os.environ, {"ATLAS_HARNESS": "codex"}):
            code, out, err = ed._codex_safe("PreToolUse", {}, (0, self.ASK + "\n", "e"))
        spec = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(spec["permissionDecision"], "deny")
        self.assertTrue(spec["permissionDecisionReason"].startswith("why"))
        self.assertGreater(len(spec["permissionDecisionReason"]), len("why"))
        self.assertNotIn("updatedInput", spec)
        self.assertEqual((code, err), (0, "e"))
        self.assertTrue(out.endswith("\n"))

    def test_codex_detected_from_payload_turn_id(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            _, out, _ = ed._codex_safe(
                "PreToolUse", {"turn_id": "t"}, (0, self.ASK, "")
            )
        self.assertEqual(
            json.loads(out)["hookSpecificOutput"]["permissionDecision"], "deny"
        )

    def test_other_events_harnesses_and_empty_output_pass_through(self):
        merged = (0, self.ASK, "")
        with mock.patch.dict(os.environ, {"ATLAS_HARNESS": "codex"}):
            self.assertIs(ed._codex_safe("PostToolUse", {}, merged), merged)
            empty = (0, "", "")
            self.assertIs(ed._codex_safe("PreToolUse", {}, empty), empty)
        with mock.patch.dict(os.environ, {"ATLAS_HARNESS": "claude"}):
            self.assertIs(ed._codex_safe("PreToolUse", {}, merged), merged)

    def test_unparseable_output_passes_through(self):
        merged = (0, "not json", "")
        with mock.patch.dict(os.environ, {"ATLAS_HARNESS": "codex"}):
            self.assertIs(ed._codex_safe("PreToolUse", {}, merged), merged)


class StripUpdatedInputTest(unittest.TestCase):
    def test_removes_only_updated_input(self):
        doc = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "updatedInput": {"a": 1},
                "additionalContext": "c",
            },
            "systemMessage": "m",
        }
        code, out, err = ed._strip_updated_input((0, json.dumps(doc), "e"))
        got = json.loads(out)
        self.assertEqual(
            got["hookSpecificOutput"],
            {"hookEventName": "PreToolUse", "additionalContext": "c"},
        )
        self.assertEqual(got["systemMessage"], "m")
        self.assertEqual((code, err), (0, "e"))
        self.assertTrue(out.endswith("\n"))

    def test_untouched_cases_return_the_same_tuple(self):
        cases = [
            (0, "", "e"),
            (0, "garbage", ""),
            (0, "[1]", ""),
            (0, json.dumps({"hookSpecificOutput": "str"}), ""),
            (0, json.dumps({"hookSpecificOutput": {"additionalContext": "c"}}), ""),
            (0, json.dumps({"other": 1}), ""),
        ]
        for merged in cases:
            self.assertIs(ed._strip_updated_input(merged), merged)


class MainEntryTest(unittest.TestCase):
    def _main(self, argv, stdin="{}", run=None):
        out, err = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(sys, "stdin", io.StringIO(stdin)),
            mock.patch.object(sys, "stdout", out),
            mock.patch.object(sys, "stderr", err),
            mock.patch.object(
                ed, "run_event", run or mock.Mock(return_value=(0, "", ""))
            ) as r,
            mock.patch.object(ed, "_fault") as fault,
        ):
            rc = ed.main(argv)
        return rc, out.getvalue(), err.getvalue(), r, fault

    def test_event_from_argv_and_streams_written(self):
        rc, out, err, run, _ = self._main(
            ["PostToolUse"], '{"a": 1}', mock.Mock(return_value=(0, "OUT\n", "ERR\n"))
        )
        self.assertEqual((rc, out, err), (0, "OUT\n", "ERR\n"))
        run.assert_called_once_with("PostToolUse", '{"a": 1}')

    def test_event_falls_back_to_hook_event_name_in_payload(self):
        _, _, _, run, _ = self._main([], '{"hook_event_name": "PreToolUse"}')
        self.assertEqual(run.call_args.args[0], "PreToolUse")

    def test_bad_argv_event_falls_back_to_payload(self):
        _, _, _, run, _ = self._main(["Bogus"], '{"hook_event_name": "PostToolUse"}')
        self.assertEqual(run.call_args.args[0], "PostToolUse")

    def test_argv_wins_over_payload(self):
        _, _, _, run, _ = self._main(
            ["PreToolUse"], '{"hook_event_name": "PostToolUse"}'
        )
        self.assertEqual(run.call_args.args[0], "PreToolUse")

    def test_unknown_event_does_nothing(self):
        for argv, stdin in (
            ([], "{}"),
            ([], "not json"),
            ([], '{"hook_event_name": "Stop"}'),
            (["Stop"], "{}"),
            ([], "[1]"),
        ):
            rc, out, err, run, _ = self._main(argv, stdin)
            self.assertEqual((rc, out, err), (0, "", ""), (argv, stdin))
            run.assert_not_called()

    def test_run_event_crash_is_contained_and_faulted(self):
        boom = mock.Mock(side_effect=RuntimeError("crash"))
        rc, out, err, _, fault = self._main(["PreToolUse"], "{}", boom)
        self.assertEqual((rc, out, err), (0, "", ""))
        name, exc = fault.call_args.args
        self.assertEqual((name, type(exc)), ("event_dispatch", RuntimeError))

    def test_exit_code_passthrough_and_empty_streams_not_written(self):
        rc, out, err, _, _ = self._main(
            ["PreToolUse"], "{}", mock.Mock(return_value=(2, "", ""))
        )
        self.assertEqual((rc, out, err), (2, "", ""))

    def test_unreadable_stdin_is_empty_payload(self):
        class Bad:
            def read(self):
                raise OSError("closed")

        out = io.StringIO()
        with (
            mock.patch.object(sys, "stdin", Bad()),
            mock.patch.object(sys, "stdout", out),
            mock.patch.object(ed, "run_event", return_value=(0, "", "")) as run,
        ):
            self.assertEqual(ed.main(["PreToolUse"]), 0)
        run.assert_called_once_with("PreToolUse", "")

    def test_default_argv_is_sys_argv(self):
        with (
            mock.patch.object(sys, "argv", ["event_dispatch.py", "PostToolUse"]),
            mock.patch.object(sys, "stdin", io.StringIO("{}")),
            mock.patch.object(ed, "run_event", return_value=(0, "", "")) as run,
        ):
            ed.main()
        self.assertEqual(run.call_args.args[0], "PostToolUse")


if __name__ == "__main__":
    unittest.main()


class BindingSliceSecondsTest(unittest.TestCase):
    """The per-hook SIGALRM slice is the budget a hook gets before it is cut off; pin each one."""

    EXPECTED = {
        "PreToolUse": {
            "recall_gate": 8,
            "bash_advisor": 8,
            "git_guard": 8,
            "edit_read_nudge": 8,
            "dispatch_tripwire": 14,
        },
        "PostToolUse": {
            "todo_capture": 8,
            "docs_drift_watch": 13,
            "delegation_prewarn": 8,
            "edit_read_nudge": 8,
            "dispatch_tripwire": 14,
            "connector_credential_watch": 8,
        },
    }

    def test_slice_seconds_per_hook(self):
        for event, want in self.EXPECTED.items():
            got = {name: secs for name, _, secs in ed.BINDINGS[event]}
            for name, secs in want.items():
                self.assertEqual(got.get(name), secs, (event, name))

    def test_every_slice_fits_inside_the_event_budget(self):
        for event, rows in ed.BINDINGS.items():
            self.assertLess(sum(s for _, _, s in rows), ed.BUDGET_S[event] * 2)
            for name, _, secs in rows:
                self.assertLess(secs, ed.BUDGET_S[event], (event, name))
