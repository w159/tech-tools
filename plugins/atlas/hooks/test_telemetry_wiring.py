"""Telemetry call sites: each key family is recorded where the event really happens.

Real hook commands run as subprocesses in an isolated ATLAS_HOME with ATLAS_ANALYTICS=on, then the
events.jsonl the client wrote is read back. In-process cases cover the slow / fault paths of
event_dispatch. Nothing here talks to a network.
"""

import json
import os
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
import atlas_analytics  # noqa: E402
import event_dispatch as ed  # noqa: E402

_AUTOMATION = set(atlas_analytics.AUTOMATION_VARS) | {
    "DO_NOT_TRACK",
    "ATLAS_ANALYTICS",
    "ATLAS_HARNESS",
}


class _Home(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.home = self._td.name
        self.cwd = os.path.join(self.home, "proj")
        os.makedirs(self.cwd)

    def env(self, **extra):
        env = {k: v for k, v in os.environ.items() if k not in _AUTOMATION}
        env.update(
            HOME=self.home,
            ATLAS_HOME=os.path.join(self.home, ".atlas"),
            ATLAS_DB=os.path.join(self.home, "atlas.db"),
            ATLAS_HOOKSTATE_DIR=os.path.join(self.home, "hookstate"),
            ATLAS_ANALYTICS="on",
            CLAUDECODE="1",
            CLAUDE_PLUGIN_ROOT=PLUGIN,
        )
        env.update(extra)
        return {k: v for k, v in env.items() if v is not None}

    def run_hook(self, script, payload, *args, **extra):
        return subprocess.run(
            [sys.executable, "-S", os.path.join(PLUGIN, script), *args],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=self.env(**extra),
            cwd=self.cwd,
            timeout=60,
        )

    def counts(self):
        path = os.path.join(self.home, ".atlas", "analytics", "events.jsonl")
        out = {}
        if not os.path.exists(path):
            return out
        with open(path, encoding="utf-8") as f:
            for line in f:
                e = json.loads(line)
                out[e["k"]] = out.get(e["k"], 0) + e["n"]
        return out


class DispatchLatencyKeyTest(_Home):
    def _bash(self, **extra):
        return self.run_hook(
            "hooks/event_dispatch.py",
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": "ls"},
                "session_id": "s",
                "cwd": self.cwd,
            },
            "PreToolUse",
            **extra,
        )

    def test_one_dispatch_records_one_ms_bucket(self):
        r = self._bash()
        self.assertEqual(r.returncode, 0, r.stderr)
        keys = [k for k in self.counts() if k.startswith("dispatch.")]
        self.assertEqual(len(keys), 1, self.counts())
        self.assertRegex(
            keys[0], r"^dispatch\.PreToolUse\.ms\.(lt50|50to200|200to1000|ge1000)$"
        )
        self.assertEqual(self.counts()[keys[0]], 1)
        self.assertTrue(atlas_analytics.valid_key(keys[0]))

    def test_opted_out_records_nothing(self):
        for extra in ({"ATLAS_ANALYTICS": "off"}, {"DO_NOT_TRACK": "1"}):
            self._bash(**extra)
        self.assertEqual(self.counts(), {})


class HookSlowAndFaultTest(_Home):
    def _run(self, hooks, event="PreToolUse"):
        table = tuple((n, "*", 5) for n in hooks)
        env = self.env()
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.dict(ed.BINDINGS, {event: table}),
            mock.patch.object(ed, "_resolve", lambda name: hooks[name]),
            mock.patch.object(ed, "_fault"),
        ):
            atlas_analytics._reset()
            try:
                return ed.run_event(
                    event, json.dumps({"tool_name": "Bash"}), harness="claude"
                )
            finally:
                atlas_analytics._reset()

    def test_slow_hook_over_threshold_records_slow(self):
        def slow():
            time.sleep(0.05)
            return 0

        with mock.patch.object(ed, "SLOW_HOOK_MS", 20):
            self._run({"git_guard": slow, "bash_advisor": lambda: 0})
        c = self.counts()
        self.assertEqual(c.get("hook.git_guard.slow"), 1, c)
        self.assertNotIn("hook.bash_advisor.slow", c)

    def test_threshold_is_documented_and_one_second(self):
        self.assertEqual(ed.SLOW_HOOK_MS, 1000)
        self.assertIn("SLOW_HOOK_MS", ed.__doc__)

    def test_raise_exit1_and_timeout_record_fault_but_exit0_and_exit2_do_not(self):
        def boom():
            raise RuntimeError("x")

        def exit1():
            raise SystemExit(1)

        def exit0():
            raise SystemExit(0)

        def block():
            sys.stderr.write("no")
            return 2

        def hang():
            time.sleep(5)
            return 0

        self._run(
            {
                "git_guard": boom,
                "bash_advisor": exit1,
                "recall_gate": exit0,
                "edit_read_nudge": block,
            }
        )
        c = self.counts()
        self.assertEqual(c.get("hook.git_guard.fault"), 1, c)
        self.assertEqual(c.get("hook.bash_advisor.fault"), 1, c)
        self.assertNotIn("hook.recall_gate.fault", c)
        self.assertNotIn("hook.edit_read_nudge.fault", c)
        self.assertEqual(c.get("hook.edit_read_nudge.deny"), 1, c)

    def test_slice_timeout_records_fault(self):
        def hang():
            time.sleep(5)
            return 0

        table = (("git_guard", "*", 0.05),)
        with (
            mock.patch.dict(os.environ, self.env(), clear=True),
            mock.patch.dict(ed.BINDINGS, {"PreToolUse": table}),
            mock.patch.object(ed, "_resolve", lambda name: hang),
            mock.patch.object(ed, "_fault"),
        ):
            atlas_analytics._reset()
            ed.run_event(
                "PreToolUse", json.dumps({"tool_name": "Bash"}), harness="claude"
            )
            atlas_analytics._reset()
        self.assertEqual(self.counts().get("hook.git_guard.fault"), 1, self.counts())

    def test_every_bound_hook_name_makes_valid_slow_and_fault_keys(self):
        names = {n for table in ed.BINDINGS.values() for n, _, _ in table}
        for n in names:
            for d in ("slow", "fault"):
                self.assertTrue(atlas_analytics.valid_key("hook.%s.%s" % (n, d)), n)


class PromptCommandTest(_Home):
    def _prompt(self, text):
        r = self.run_hook(
            "hooks/prompt_optimizer.py",
            {
                "hook_event_name": "UserPromptSubmit",
                "prompt": text,
                "session_id": "s",
                "cwd": self.cwd,
            },
            ATLAS_ENGINE_ARM="off",
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        return {k: v for k, v in self.counts().items() if k.startswith("command.")}

    def test_namespaced_and_bare_slash_forms_record_the_command(self):
        self.assertEqual(
            self._prompt("/atlas:atlas-plan do the thing"), {"command.atlas-plan": 1}
        )
        self.assertEqual(
            self._prompt("/atlas-plan do the thing"), {"command.atlas-plan": 2}
        )
        self.assertEqual(
            self._prompt("  /atlas:atlas-ship"),
            {"command.atlas-plan": 2, "command.atlas-ship": 1},
        )

    def test_non_skill_prompts_record_nothing(self):
        for text in (
            "/atlas-not-a-skill x",
            "/atlas:atlas-not-a-skill",
            "/other:atlas-plan",
            "/plan",
            "please run /atlas-plan",
            "atlas-plan",
            "/",
            "/atlas-plan/../../etc",
        ):
            self.assertEqual(self._prompt(text), {}, text)

    def test_prompt_text_never_reaches_the_event_log(self):
        self._prompt("/atlas:atlas-plan SECRET-ARGUMENT-VALUE")
        path = os.path.join(self.home, ".atlas", "analytics", "events.jsonl")
        self.assertNotIn("SECRET-ARGUMENT-VALUE", open(path, encoding="utf-8").read())

    def test_key_helper(self):
        self.assertEqual(ed.prompt_command_key("/atlas:atlas-plan x"), "command.atlas-plan")
        self.assertEqual(ed.prompt_command_key("/atlas-plan"), "command.atlas-plan")
        self.assertIsNone(ed.prompt_command_key("hello"))
        self.assertIsNone(ed.prompt_command_key(None))


class SessionStartWiringTest(_Home):
    def _boot(self, **extra):
        r = self.run_hook(
            "hooks/session_boot.py",
            {
                "hook_event_name": "SessionStart",
                "source": "startup",
                "session_id": "s-boot",
                "cwd": self.cwd,
            },
            **extra,
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_session_is_counted_once_per_boot_by_harness(self):
        self._boot()
        self.assertEqual(self.counts().get("session.claude"), 1, self.counts())
        self._boot(ATLAS_HARNESS="codex")
        self._boot(ATLAS_HARNESS="omp")
        c = self.counts()
        self.assertEqual(
            (c.get("session.claude"), c.get("session.codex"), c.get("session.omp")),
            (1, 1, 1),
            c,
        )

    def test_compact_source_is_not_a_new_session(self):
        r = self.run_hook(
            "hooks/session_boot.py",
            {
                "hook_event_name": "SessionStart",
                "source": "compact",
                "session_id": "s-boot",
                "cwd": self.cwd,
            },
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.counts(), {})

    def test_first_run_notice_reaches_user_in_system_message_for_claude_and_codex(self):
        for harness in ("claude", "codex"):
            home = tempfile.mkdtemp(dir=self.home)
            env = {
                "HOME": home,
                "ATLAS_HOME": os.path.join(home, ".atlas"),
                "ATLAS_HARNESS": harness,
                "ATLAS_ANALYTICS": None,
            }
            out = self._boot(**env)
            self.assertIn("anonymous usage counts", out["systemMessage"], harness)
            self.assertIn(
                "anonymous usage counts",
                out["hookSpecificOutput"]["additionalContext"],
                harness,
            )
            again = self._boot(**env)  # once per schema version
            self.assertNotIn("anonymous usage counts", again["systemMessage"], harness)

    def test_opt_out_shows_no_notice(self):
        out = self._boot(ATLAS_ANALYTICS="off")
        self.assertNotIn("anonymous usage counts", out["systemMessage"])
        self.assertEqual(self.counts(), {})


if __name__ == "__main__":
    unittest.main()
