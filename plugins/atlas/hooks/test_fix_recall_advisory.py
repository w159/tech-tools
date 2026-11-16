"""17.27.0: the Claude Code recall gate is advisory by default (one reminder, never a deny);
ATLAS_RECALL_GATE=deny restores the legacy deny."""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recall_gate  # noqa: E402

CC_SEARCH = "mcp__plugin_claude-mem_mcp-search__search"


class RecallAdvisoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._dir = recall_gate.GATE_MARKER_DIR
        recall_gate.GATE_MARKER_DIR = self.tmp
        self.addCleanup(lambda: setattr(recall_gate, "GATE_MARKER_DIR", self._dir))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        for p in (
            patch.object(recall_gate, "_claude_mem_enabled", return_value=True),
            patch.object(recall_gate, "_mem_server_mounted", return_value=True),
            patch.object(recall_gate, "_gates_armed", return_value=True),
            patch.dict(os.environ),
        ):
            p.start()
            self.addCleanup(p.stop)
        for k in ("ATLAS_MANDATES", "ATLAS_RECALL_GATE", "ATLAS_WORKER_NAME"):
            os.environ.pop(k, None)

    def _run(self, tool="Bash", session="sess-adv", tool_input=None):
        payload = {
            "session_id": session,
            "hook_event_name": "PreToolUse",
            "tool_name": tool,
            "tool_input": tool_input if tool_input is not None else {"command": "ls"},
            "transcript_path": "/home/u/.claude/projects/p/%s.jsonl" % session,
            "cwd": self.tmp,
        }
        buf = io.StringIO()
        with patch("sys.stdin", new=io.StringIO(json.dumps(payload))), redirect_stdout(buf):
            self.assertEqual(recall_gate.main(), 0)
        out = buf.getvalue().strip()
        return json.loads(out)["hookSpecificOutput"] if out else None

    def test_first_call_is_allowed_with_one_advisory(self):
        spec = self._run()
        self.assertIsNotNone(spec)
        self.assertEqual(spec["hookEventName"], "PreToolUse")
        self.assertEqual(spec.get("permissionDecision", "allow"), "allow")
        self.assertNotIn("permissionDecisionReason", spec)
        ctx = spec["additionalContext"]
        self.assertIn(CC_SEARCH, ctx)
        self.assertNotIn("denied", ctx.lower())

    def test_second_call_is_silent(self):
        self._run()
        self.assertIsNone(self._run())
        self.assertIsNone(self._run(tool="Read", tool_input={"file_path": "/x"}))

    def test_recall_marks_recalled_without_advisory(self):
        self.assertIsNone(self._run(tool=CC_SEARCH, tool_input={"query": "x"}))
        self.assertTrue(os.path.exists(recall_gate._marker("sess-adv")))
        self.assertIsNone(self._run())

    def test_env_deny_restores_the_deny(self):
        os.environ["ATLAS_RECALL_GATE"] = "deny"
        spec = self._run()
        self.assertEqual(spec["permissionDecision"], "deny")
        self.assertIn(CC_SEARCH, spec["permissionDecisionReason"])
        self.assertEqual(self._run()["permissionDecision"], "deny")

    def test_fault_path_fails_open(self):
        with patch.object(
            recall_gate, "_contract", side_effect=RuntimeError("boom")
        ), patch.object(recall_gate, "_record_fault") as fault:
            self.assertIsNone(self._run())
        fault.assert_called_once()


if __name__ == "__main__":
    unittest.main()
