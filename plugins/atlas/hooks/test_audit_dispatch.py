"""Regression tests for the dispatch audit fixes: single SCOPE line, visible budget skip, guarded shims."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(PLUGIN, "scripts"))

import _test_isolation  # noqa: F401,E402
import dispatch_tripwire_core as core  # noqa: E402
import event_dispatch as ed  # noqa: E402


class ScopeLineTest(unittest.TestCase):
    def _problem(self, prompt):
        return core._scope_problem({"subagent_type": "atlas:explorer", "prompt": prompt})

    def test_single_line_still_passes(self):
        self.assertEqual(self._problem("GOAL: x\nSCOPE: audit/medium\n"), "")

    def test_two_distinct_lines_denied(self):
        msg = self._problem("SCOPE: audit/medium\nSCOPE: audit/high\n")
        self.assertIn("one SCOPE line", msg)

    def test_repeated_identical_line_is_one_scope(self):
        self.assertEqual(self._problem("SCOPE: audit/medium\nSCOPE: audit/medium\n"), "")


class BudgetSkipTest(unittest.TestCase):
    def test_pretooluse_budget_skip_is_visible_not_a_deny(self):
        raw = json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls"}, "hook_event_name": "PreToolUse"})
        with mock.patch.object(ed, "BUDGET_S", {"PreToolUse": 0.0}), mock.patch.object(ed, "_fault"):
            code, out, _ = ed.run_event("PreToolUse", raw, harness="claude")
        self.assertEqual(code, 0)
        doc = json.loads(out)
        self.assertIn("dispatch_tripwire", doc["systemMessage"])
        self.assertNotIn("permissionDecision", doc.get("hookSpecificOutput", {}))


class ShimFailOpenTest(unittest.TestCase):
    def test_broken_import_fails_open_with_message(self):
        for name in ("dispatch_tripwire", "session_boot", "prompt_optimizer"):
            with self.subTest(shim=name), tempfile.TemporaryDirectory() as tmp:
                os.makedirs(os.path.join(tmp, "hooks"))
                os.makedirs(os.path.join(tmp, "scripts"))
                shutil.copy(os.path.join(HERE, name + ".py"), os.path.join(tmp, "hooks", name + ".py"))
                with open(os.path.join(tmp, "scripts", "atlas_env.py"), "w") as fh:
                    fh.write("def apply_store_env():\n    pass\n")
                proc = subprocess.run(
                    [sys.executable, os.path.join(tmp, "hooks", name + ".py")],
                    input="{}", capture_output=True, text=True, cwd=tmp,
                )
                self.assertEqual(proc.returncode, 0, proc.stderr)
                self.assertIn("FAIL-OPEN", json.loads(proc.stdout)["systemMessage"])


if __name__ == "__main__":
    unittest.main()
