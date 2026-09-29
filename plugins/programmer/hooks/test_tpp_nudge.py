"""Tests for tpp_nudge.py, the UserPromptSubmit command hook.

Runs the script as a subprocess (stdin -> stdout/exit code) to exercise the
real hook contract, plus a couple of direct-import checks against DOMAIN_MAP.
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

HOOK_PATH = Path(__file__).resolve().parent / "tpp_nudge.py"

sys.path.insert(0, str(HOOK_PATH.parent))
import tpp_nudge  # noqa: E402


def run_hook(stdin_text: str):
    proc = subprocess.run(
        [sys.executable, str(HOOK_PATH)],
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return proc.returncode, proc.stdout


class TestDomainMap(unittest.TestCase):
    def test_every_concept_file_exists(self):
        for keywords, concept, reason in tpp_nudge.DOMAIN_MAP:
            path = tpp_nudge.CONCEPTS_DIR / concept
            self.assertTrue(
                path.is_file(),
                f"missing concept file for domain {keywords!r}: {path}",
            )


class TestHookSubprocess(unittest.TestCase):
    def test_task_notification_is_silent(self):
        code, out = run_hook(json.dumps({"prompt": "<task-notification>x"}))
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_slash_command_is_silent(self):
        code, out = run_hook(json.dumps({"prompt": "/model"}))
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_meta_question_never_blocks(self):
        code, out = run_hook(
            json.dumps({"prompt": "which hook is blocking operations?"})
        )
        self.assertEqual(code, 0)
        self.assertNotIn("decision", out)

    def test_race_condition_matches_shared_state(self):
        code, out = run_hook(
            json.dumps({"prompt": "fix this race condition in the worker"})
        )
        self.assertEqual(code, 0)
        self.assertIn("shared-state.md", out)

    def test_tdd_matches_test_driven_development(self):
        code, out = run_hook(json.dumps({"prompt": "write the test first with tdd"}))
        self.assertEqual(code, 0)
        self.assertIn("test-driven-development.md", out)

    def test_malformed_stdin_is_silent_and_exits_zero(self):
        code, out = run_hook("not json{{{")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")


if __name__ == "__main__":
    unittest.main()
