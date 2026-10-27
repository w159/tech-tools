"""event_dispatch runs the PreToolUse/PostToolUse Python hooks in one process.

Pins: the binding table equals the former per-hook hooks.json bindings (table-driven over every
binding and a tool universe), the merge rules (deny precedence, context order, updatedInput,
exit 2), per-hook fail-open and time slices, and that the dispatcher's merged output equals the
merge of each hook run alone as its own process (the old behavior).
"""

import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(PLUGIN, "scripts"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import event_dispatch as ed  # noqa: E402

# hooks.json before the dispatcher: (event, matcher, script), in file order.
FORMER = (
    ("PreToolUse", "*", "recall_gate"),
    ("PreToolUse", "Bash", "bash_advisor"),
    ("PreToolUse", "Bash", "fallow_gate"),
    ("PreToolUse", "Edit|edit|MultiEdit", "edit_read_nudge"),
    (
        "PreToolUse",
        "Edit|Write|MultiEdit|NotebookEdit|Read|Grep|Glob|Bash|Agent|Task",
        "dispatch_tripwire",
    ),
    ("PostToolUse", "TodoWrite|Agent|Task|Bash", "todo_capture"),
    ("PostToolUse", "Edit|Write|MultiEdit|NotebookEdit", "format_after_edit"),
    ("PostToolUse", "Edit|Write|MultiEdit|NotebookEdit", "docs_drift_watch"),
    ("PostToolUse", "Edit|Write|MultiEdit|NotebookEdit", "delegation_prewarn"),
    ("PostToolUse", "Read|read|mcp__.*ctx_read", "edit_read_nudge"),
    (
        "PostToolUse",
        "Read|Grep|Glob|Edit|Write|Bash|Agent|Task|MultiEdit|NotebookEdit|Skill",
        "dispatch_tripwire",
    ),
    (
        "PostToolUse",
        "mcp__plugin_armada_.*|mcp__falcon-mcp__.*|mcp__cipp.*|mcp__connectwise.*"
        "|mcp__plaid__.*|mcp__gcloud__.*",
        "connector_credential_watch",
    ),
)
STANDALONE = {"fallow_gate", "format_after_edit"}  # keep their own hooks.json process

TOOLS = (
    "Edit edit MultiEdit Write NotebookEdit Read read Grep Glob Bash Agent Task Skill TodoWrite "
    "WebFetch WebSearch BashOutput Editor ReadMe mcp__lean-ctx__ctx_read mcp__x__ctx_read_all "
    "mcp__plugin_armada_falcon__falcon_status mcp__falcon-mcp__x mcp__cipp_x mcp__connectwise__y "
    "mcp__plaid__z mcp__gcloud__a mcp__other__thing xd://x"
).split() + ["", None]


def _old_selection(event, tool):
    """Scripts the former hooks.json ran for (event, tool), in order."""
    return [
        script
        for ev, matcher, script in FORMER
        if ev == event and (matcher == "*" or re.fullmatch(matcher, tool or ""))
    ]


def _hooks_json():
    with open(os.path.join(HERE, "hooks.json"), encoding="utf-8") as fh:
        return json.load(fh)["hooks"]


class BindingTableTest(unittest.TestCase):
    def test_every_former_binding_is_dispatched_or_standalone_with_same_matcher(self):
        dispatched = [(e, m, n) for e, bs in ed.BINDINGS.items() for n, m, _ in bs]
        hooks = _hooks_json()
        wired = json.dumps([hooks["PreToolUse"], hooks["PostToolUse"]])
        for event, matcher, script in FORMER:
            with self.subTest(event=event, script=script):
                if script in STANDALONE:
                    self.assertIn(script + ".py", wired)
                    self.assertNotIn((event, matcher, script), dispatched)
                else:
                    self.assertIn((event, matcher, script), dispatched)
                    self.assertNotIn(script + ".py", wired)
        self.assertEqual(
            len(dispatched), len([f for f in FORMER if f[2] not in STANDALONE])
        )

    def test_selection_is_identical_to_the_former_bindings_for_every_tool(self):
        for event in ed.BINDINGS:
            for tool in TOOLS:
                with self.subTest(event=event, tool=tool):
                    former = [
                        s for s in _old_selection(event, tool) if s not in STANDALONE
                    ]
                    self.assertEqual(ed.select(event, tool, harness="claude"), former)

    def test_omp_skips_the_natively_implemented_hooks(self):
        self.assertNotIn("recall_gate", ed.select("PreToolUse", "Bash", harness="omp"))
        self.assertIn("recall_gate", ed.select("PreToolUse", "Bash", harness="claude"))
        self.assertNotIn(
            "todo_capture", ed.select("PostToolUse", "TodoWrite", harness="omp")
        )

    def test_hooks_json_outer_matcher_covers_exactly_the_inner_bindings(self):
        hooks = _hooks_json()
        for event in ed.BINDINGS:
            groups = [
                g
                for g in hooks[event]
                if any("event_dispatch.py" in h["command"] for h in g["hooks"])
            ]
            self.assertEqual(len(groups), 1, event)
            (g,) = groups
            self.assertEqual(g["matcher"], ed.outer_matcher(event))
            (h,) = g["hooks"]
            self.assertTrue(h["command"].endswith('event_dispatch.py" %s' % event))
            self.assertGreaterEqual(h["timeout"], ed.BUDGET_S[event])
            for tool in TOOLS:
                outer = ed.matches(g["matcher"], tool)
                inner = any(ed.matches(m, tool) for _, m, _ in ed.BINDINGS[event])
                self.assertEqual(outer, inner, (event, tool))

    def test_slices_fit_the_budget_for_every_tool(self):
        slices = {e: {n: s for n, _, s in bs} for e, bs in ed.BINDINGS.items()}
        for event in ed.BINDINGS:
            for tool in TOOLS:
                total = sum(slices[event][n] for n in ed.select(event, tool, "claude"))
                self.assertLessEqual(total, ed.BUDGET_S[event], (event, tool))

    def test_omp_contract_dispatch_table_equals_bindings(self):
        with open(
            os.path.join(PLUGIN, "contracts", "hook-bridge.json"), encoding="utf-8"
        ) as fh:
            table = json.load(fh)["dispatch"]
        self.assertEqual(
            {
                e: [(i["script"], i["matcher"]) for i in rows]
                for e, rows in table.items()
            },
            {e: [(n + ".py", m) for n, m, _ in bs] for e, bs in ed.BINDINGS.items()},
        )


def _doc(event, **spec):
    return json.dumps({"hookSpecificOutput": dict(hookEventName=event, **spec)})


def _res(name, out="", rc=0, err=""):
    return (name, rc, out, err)


class MergeTest(unittest.TestCase):
    def merged(self, *results, event="PreToolUse"):
        code, out, err = ed.merge(event, list(results))
        return code, (json.loads(out) if out.strip() else None), err

    def test_nothing_printed_is_silent_exit_zero(self):
        self.assertEqual(self.merged(_res("a"), _res("b")), (0, None, ""))

    def test_single_document_passes_through_unchanged(self):
        doc = _doc("PreToolUse", additionalContext="hi")
        code, out, _ = ed.merge("PreToolUse", [_res("a", doc), _res("b")])
        self.assertEqual(json.loads(out), json.loads(doc))

    def test_deny_beats_ask_and_allow_first_deny_reason_wins(self):
        _, doc, _ = self.merged(
            _res("a", _doc("PreToolUse", permissionDecision="allow")),
            _res(
                "b",
                _doc(
                    "PreToolUse",
                    permissionDecision="ask",
                    permissionDecisionReason="r-ask",
                ),
            ),
            _res(
                "c",
                _doc(
                    "PreToolUse",
                    permissionDecision="deny",
                    permissionDecisionReason="first",
                ),
            ),
            _res(
                "d",
                _doc(
                    "PreToolUse",
                    permissionDecision="deny",
                    permissionDecisionReason="second",
                ),
            ),
        )
        spec = doc["hookSpecificOutput"]
        self.assertEqual(spec["permissionDecision"], "deny")
        self.assertEqual(spec["permissionDecisionReason"], "first")
        self.assertIn("[also blocked] second", spec["additionalContext"])

    def test_ask_beats_allow_and_keeps_its_reason(self):
        _, doc, _ = self.merged(
            _res("a", _doc("PreToolUse", permissionDecision="allow")),
            _res(
                "b",
                _doc(
                    "PreToolUse",
                    permissionDecision="ask",
                    permissionDecisionReason="why",
                ),
            ),
        )
        spec = doc["hookSpecificOutput"]
        self.assertEqual(
            (spec["permissionDecision"], spec["permissionDecisionReason"]),
            ("ask", "why"),
        )

    def test_context_from_every_hook_in_binding_order_and_rides_with_a_deny(self):
        _, doc, _ = self.merged(
            _res("a", _doc("PreToolUse", additionalContext="one")),
            _res(
                "b",
                _doc(
                    "PreToolUse",
                    permissionDecision="deny",
                    permissionDecisionReason="no",
                ),
            ),
            _res("c", _doc("PreToolUse", additionalContext="three")),
        )
        spec = doc["hookSpecificOutput"]
        self.assertEqual(spec["additionalContext"], "one\n\nthree")
        self.assertEqual(spec["permissionDecision"], "deny")

    def test_context_order_without_a_decision(self):
        _, doc, _ = self.merged(
            _res("a", _doc("PostToolUse", additionalContext="A")),
            _res("b", _doc("PostToolUse", additionalContext="B")),
            event="PostToolUse",
        )
        self.assertEqual(doc["hookSpecificOutput"]["additionalContext"], "A\n\nB")
        self.assertEqual(doc["hookSpecificOutput"]["hookEventName"], "PostToolUse")

    def test_updated_input_survives_unless_a_deny_wins(self):
        upd = {"command": "ls"}
        allow = _res(
            "t", _doc("PreToolUse", permissionDecision="allow", updatedInput=upd)
        )
        ctx = _res("n", _doc("PreToolUse", additionalContext="note"))
        _, doc, _ = self.merged(ctx, allow)
        spec = doc["hookSpecificOutput"]
        self.assertEqual(
            (spec["updatedInput"], spec["permissionDecision"]), (upd, "allow")
        )
        self.assertEqual(spec["additionalContext"], "note")
        _, doc, _ = self.merged(
            allow,
            _res(
                "d",
                _doc(
                    "PreToolUse",
                    permissionDecision="deny",
                    permissionDecisionReason="x",
                ),
            ),
        )
        self.assertNotIn("updatedInput", doc["hookSpecificOutput"])

    def test_exit_two_blocks_with_stderr_and_drops_stdout(self):
        code, out, err = ed.merge(
            "PreToolUse",
            [
                _res("a", _doc("PreToolUse", additionalContext="x")),
                _res("b", "", 2, "stop it\n"),
            ],
        )
        self.assertEqual((code, out, err), (2, "", "stop it\n"))

    def test_other_exit_codes_are_clean_and_stderr_concatenates(self):
        code, out, err = ed.merge(
            "PreToolUse", [_res("a", "", 1, "w1"), _res("b", "", 0, "w2\n")]
        )
        self.assertEqual((code, out, err), (0, "", "w1\nw2\n"))

    def test_non_json_stdout_is_not_part_of_the_document(self):
        code, out, err = ed.merge("PreToolUse", [_res("a", "plain words")])
        self.assertEqual((code, out), (0, ""))
        self.assertIn("non-JSON", err)

    def test_legacy_block_decision_and_system_messages_merge(self):
        _, doc, _ = self.merged(
            _res("a", json.dumps({"systemMessage": "s1"})),
            _res(
                "b",
                json.dumps({"decision": "block", "reason": "r", "systemMessage": "s2"}),
            ),
            event="PostToolUse",
        )
        self.assertEqual((doc["decision"], doc["reason"]), ("block", "r"))
        self.assertEqual(doc["systemMessage"], "s1\n\ns2")


class _Fake:
    def __init__(self, behavior):
        self.behavior = behavior

    def main(self):
        return self.behavior()


class RunEventTest(unittest.TestCase):
    def run_fakes(self, fakes, bindings=None, budget=30.0):
        names = [n for n, *_ in (bindings or [])] or list(fakes)
        table = bindings or [(n, "*", 5) for n in names]
        with (
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": tuple(table)}),
            mock.patch.dict(ed.BUDGET_S, {"PreToolUse": budget}),
            mock.patch.object(ed, "_resolve", lambda name: fakes[name].main),
            mock.patch.object(ed, "_fault") as fault,
        ):
            payload = json.dumps({"tool_name": "Bash", "session_id": "s"})
            return ed.run_event("PreToolUse", payload, harness="claude"), fault

    @staticmethod
    def say(text=None, deny=None):
        def fn():
            if deny:
                print(
                    _doc(
                        "PreToolUse",
                        permissionDecision="deny",
                        permissionDecisionReason=deny,
                    )
                )
            elif text:
                print(_doc("PreToolUse", additionalContext=text))
            return 0

        return fn

    def test_hooks_run_in_order_each_with_the_payload_on_stdin(self):
        seen = []

        def reader(tag):
            def fn():
                seen.append((tag, json.loads(sys.stdin.read())["tool_name"]))
                return 0

            return fn

        self.run_fakes({"a": _Fake(reader("a")), "b": _Fake(reader("b"))})
        self.assertEqual(seen, [("a", "Bash"), ("b", "Bash")])

    def test_a_raising_hook_does_not_block_the_others(self):
        def boom():
            raise RuntimeError("boom")

        (code, out, err), fault = self.run_fakes(
            {"a": _Fake(boom), "b": _Fake(self.say("still here"))}
        )
        self.assertEqual(code, 0)
        self.assertEqual(
            json.loads(out)["hookSpecificOutput"]["additionalContext"], "still here"
        )
        self.assertEqual(fault.call_args[0][0], "a")

    def test_systemexit_from_a_hook_is_contained(self):
        def bail():
            sys.exit(0)

        (code, out, _), _ = self.run_fakes(
            {"a": _Fake(bail), "b": _Fake(self.say("ok"))}
        )
        self.assertEqual(code, 0)
        self.assertIn("ok", out)

    def test_deny_from_a_later_hook_wins_over_earlier_context(self):
        (code, out, _), _ = self.run_fakes(
            {"a": _Fake(self.say("fyi")), "b": _Fake(self.say(deny="blocked"))}
        )
        spec = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(
            (spec["permissionDecision"], spec["permissionDecisionReason"]),
            ("deny", "blocked"),
        )
        self.assertEqual(spec["additionalContext"], "fyi")

    @unittest.skipUnless(hasattr(__import__("signal"), "SIGALRM"), "needs SIGALRM")
    def test_a_hung_hook_is_cut_at_its_slice_and_the_next_still_runs(self):
        def hang():
            print(_doc("PreToolUse", additionalContext="partial"))
            time.sleep(30)

        started = time.monotonic()
        (code, out, _), fault = self.run_fakes(
            {"slow": _Fake(hang), "next": _Fake(self.say("after"))},
            bindings=[("slow", "*", 1), ("next", "*", 5)],
        )
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual(code, 0)
        self.assertEqual(
            json.loads(out)["hookSpecificOutput"]["additionalContext"], "after"
        )
        self.assertEqual(fault.call_args[0][0], "slow")

    @unittest.skipUnless(hasattr(__import__("signal"), "SIGALRM"), "needs SIGALRM")
    def test_slice_never_exceeds_the_remaining_budget(self):
        seen = []

        def spend():
            time.sleep(1.3)

        real = ed._invoke

        def spy(name, raw, seconds, cwd=None):
            seen.append((name, round(seconds, 1)))
            return real(name, raw, seconds, cwd)

        with mock.patch.object(ed, "_invoke", spy):
            self.run_fakes(
                {"a": _Fake(spend), "b": _Fake(lambda: 0)},
                bindings=[("a", "*", 5), ("b", "*", 5)],
                budget=2.0,
            )
        self.assertEqual(seen[0], ("a", 1.5))
        self.assertLessEqual(seen[1][1], 0.3)

    def test_matcher_filtering_inside_run_event(self):
        ran = []

        def mark(tag):
            def fn():
                ran.append(tag)
                return 0

            return fn

        fakes = {
            "b": _Fake(mark("b")),
            "e": _Fake(mark("e")),
            "all": _Fake(mark("all")),
        }
        with (
            mock.patch.dict(
                ed.BINDINGS,
                {
                    "PreToolUse": (
                        ("all", "*", 5),
                        ("b", "Bash", 5),
                        ("e", "Edit|edit", 5),
                    )
                },
            ),
            mock.patch.object(ed, "_resolve", lambda name: fakes[name].main),
        ):
            ed.run_event(
                "PreToolUse", json.dumps({"tool_name": "Edit"}), harness="claude"
            )
        self.assertEqual(ran, ["all", "e"])

    def test_garbage_stdin_still_runs_only_wildcard_hooks_and_never_raises(self):
        ran = []
        fakes = {
            "all": _Fake(lambda: ran.append("all") or 0),
            "b": _Fake(lambda: ran.append("b") or 0),
        }
        with (
            mock.patch.dict(
                ed.BINDINGS, {"PreToolUse": (("all", "*", 5), ("b", "Bash", 5))}
            ),
            mock.patch.object(ed, "_resolve", lambda name: fakes[name].main),
        ):
            self.assertEqual(
                ed.run_event("PreToolUse", "{not json", harness="claude"), (0, "", "")
            )
        self.assertEqual(ran, ["all"])

    def test_main_returns_exit_two_and_writes_streams(self):
        with (
            mock.patch.object(ed, "run_event", return_value=(2, "", "no\n")),
            mock.patch.object(sys, "stdin", io.StringIO("{}")),
            mock.patch.object(sys, "stderr", io.StringIO()) as err,
        ):
            self.assertEqual(ed.main(["PreToolUse"]), 2)
        self.assertEqual(err.getvalue(), "no\n")

    def test_main_ignores_an_unknown_event(self):
        with mock.patch.object(sys, "stdin", io.StringIO("{}")):
            self.assertEqual(ed.main(["Stop"]), 0)


class ParityTest(unittest.TestCase):
    """The dispatcher's output equals the merge of each hook run alone as its own process."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.projs = {}

    def _proj(self, tag):
        """A fresh git project per mode: hooks keep debounce/marker state under .atlas/.run."""
        if tag not in self.projs:
            proj = os.path.join(self.tmp.name, "proj-" + tag, "proj")
            os.makedirs(proj)
            subprocess.run(["git", "init", "-q", proj], check=True)
            with open(os.path.join(proj, "a.py"), "w") as fh:
                fh.write("a = 1\n")
            self.projs[tag] = proj
        return self.projs[tag]

    def _env(self, tag):
        home = os.path.join(self.tmp.name, "home-" + tag)
        os.makedirs(home, exist_ok=True)
        # delegation_prewarn keeps its once-per-session marker under TMPDIR: isolate it per mode.
        tmpdir = os.path.join(self.tmp.name, "tmp-" + tag)
        os.makedirs(tmpdir, exist_ok=True)
        env = dict(
            os.environ,
            TMPDIR=tmpdir,
            CLAUDE_PLUGIN_ROOT=PLUGIN,
            ATLAS_HOME=home,
            ATLAS_DB=os.path.join(home, "atlas.db"),
            ATLAS_HOOKSTATE_DIR=os.path.join(home, "hookstate"),
            CLAUDE_PROJECT_DIR=self._proj(tag),
            ATLAS_DASHBOARD="off",
            ATLAS_COLONY="off",
            ATLAS_MANDATES="off",
            ATLAS_DECISION="off",
        )
        env.pop("ATLAS_HARNESS", None)
        return env

    def _payload(self, tag, event, tool, tool_input):
        return json.dumps(
            {
                "cwd": self._proj(tag),
                "session_id": "parity",
                "hook_event_name": event,
                "tool_name": tool,
                "tool_input": tool_input,
                "tool_response": {"success": True},
            }
        )

    def _alone(self, event, tool, tool_input):
        """Old behavior: every dispatched hook for this tool as its own process, then merge."""
        raw = self._payload("alone", event, tool, tool_input)
        env = self._env("alone")
        results = []
        for name in ed.select(event, tool, "claude"):
            script = os.path.join(HERE, name + ".py")
            p = subprocess.run(
                [sys.executable, "-S", script],
                input=raw,
                capture_output=True,
                text=True,
                env=env,
                cwd=self._proj("alone"),
                timeout=60,
            )
            results.append((name, p.returncode, p.stdout, p.stderr))
        code, out, _ = ed.merge(event, results)
        return code, json.loads(out) if out.strip() else None

    def _dispatched(self, event, tool, tool_input):
        raw = self._payload("dispatch", event, tool, tool_input)
        p = subprocess.run(
            [sys.executable, "-S", os.path.join(HERE, "event_dispatch.py"), event],
            input=raw,
            capture_output=True,
            text=True,
            env=self._env("dispatch"),
            cwd=self._proj("dispatch"),
            timeout=60,
        )
        return p.returncode, json.loads(p.stdout) if p.stdout.strip() else None

    CASES = (
        ("PreToolUse", "Bash", {"command": "rm -rf /"}),
        ("PreToolUse", "Bash", {"command": "ls -la"}),
        ("PreToolUse", "Bash", {"command": "cat .env && echo $AWS_SECRET_ACCESS_KEY"}),
        (
            "PreToolUse",
            "Edit",
            {"file_path": "a.py", "old_string": "a", "new_string": "b"},
        ),
        ("PreToolUse", "Read", {"file_path": "a.py"}),
        ("PreToolUse", "WebFetch", {"url": "https://example.com"}),
        (
            "PreToolUse",
            "Agent",
            {
                "subagent_type": "atlas:implementer",
                "prompt": "do it",
                "description": "x",
            },
        ),
        (
            "PostToolUse",
            "Edit",
            {"file_path": "a.py", "old_string": "a", "new_string": "b"},
        ),
        ("PostToolUse", "Read", {"file_path": "a.py"}),
        ("PostToolUse", "Bash", {"command": "ls"}),
        (
            "PostToolUse",
            "TodoWrite",
            {"todos": [{"content": "x", "status": "pending", "activeForm": "x"}]},
        ),
        ("PostToolUse", "WebSearch", {"query": "q"}),
    )

    def _norm(self, result):
        """Per-run noise out: the project path and the random 4-hex name suffixes."""
        code, doc = result
        text = json.dumps(doc, sort_keys=True)
        for proj in self.projs.values():
            text = text.replace(proj, "<P>").replace(proj.replace("/", "\\/"), "<P>")
        text = re.sub(r"\bt[0-9a-f]{8}\b", "tXXXXXXXX", text)  # board item ids
        return code, re.sub(r"-[0-9a-f]{4}\b", "-XXXX", text)

    def test_dispatcher_equals_the_hooks_run_alone(self):
        for event, tool, tool_input in self.CASES:
            with self.subTest(event=event, tool=tool, input=tool_input):
                self.assertEqual(
                    self._norm(self._dispatched(event, tool, tool_input)),
                    self._norm(self._alone(event, tool, tool_input)),
                )

    def test_catastrophic_bash_is_advisory_context_not_a_deny(self):
        code, doc = self._dispatched("PreToolUse", "Bash", {"command": "rm -rf /"})
        self.assertEqual(code, 0)
        spec = doc["hookSpecificOutput"]
        self.assertIn("catastrophic", spec["additionalContext"])
        self.assertNotIn("permissionDecision", spec)


if __name__ == "__main__":
    unittest.main()
