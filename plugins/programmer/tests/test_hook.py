"""The opt-in PostToolUse hook: silent when off, silent when clean, one JSON context block on errors."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "scan_on_edit.py"
BAD = 'def run(cur, uid):\n    cur.execute(f"SELECT * FROM t WHERE id = {uid}")\n'


def run_hook(payload, enabled=True):
    env = dict(os.environ)
    env.pop("PROGRAMMER_SCAN_ON_EDIT", None)
    if enabled:
        env["PROGRAMMER_SCAN_ON_EDIT"] = "1"
    return subprocess.run([sys.executable, str(HOOK)], input=payload, capture_output=True, text=True, env=env)


class Hook(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.file = Path(self.tmp.name) / "bad.py"
        self.file.write_text(BAD)
        self.event = json.dumps({"hook_event_name": "PostToolUse", "tool_name": "Edit", "tool_input": {"file_path": str(self.file)}})

    def tearDown(self):
        self.tmp.cleanup()

    def test_off_by_default(self):
        r = run_hook(self.event, enabled=False)
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_reports_error_findings(self):
        r = run_hook(self.event)
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)["hookSpecificOutput"]
        self.assertEqual(out["hookEventName"], "PostToolUse")
        self.assertIn("bad.py:2 SEC001", out["additionalContext"])

    def test_clean_file_is_silent(self):
        self.file.write_text("def f(x):\n    return x\n")
        r = run_hook(self.event)
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_bad_input_never_blocks(self):
        for payload in ("not json", json.dumps({"tool_input": {"file_path": "/nope/x.py"}}), json.dumps({}),
                        json.dumps({"tool_input": {"file_path": str(self.file.with_suffix(".md"))}})):
            r = run_hook(payload)
            self.assertEqual((r.returncode, r.stdout), (0, ""), payload)

    def test_unparseable_file_is_silent(self):
        self.file.write_text("def f(:\n")
        r = run_hook(self.event)
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def edit_event(self, old, new, **extra):
        ti = {"file_path": str(self.file), "old_string": old, "new_string": new, **extra}
        return json.dumps({"hook_event_name": "PostToolUse", "tool_name": "Edit", "tool_input": ti})

    def test_edit_reports_only_findings_it_introduced(self):
        old = "def other(x):\n    return x\n"
        self.file.write_text(BAD + old)
        added = "def other(x):\n    return x + 1\n"
        self.file.write_text(BAD + added)
        r = run_hook(self.edit_event(old, added))
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_edit_reports_the_new_finding_not_the_old_one(self):
        new_bad = "def run2(cur, name):\n    cur.execute(f\"SELECT * FROM t WHERE n = {name}\")\n"
        old = "def other(x):\n    return x\n"
        self.file.write_text(BAD + new_bad)
        r = run_hook(self.edit_event(old, new_bad))
        ctx = json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("bad.py:4 SEC001", ctx)
        self.assertNotIn("bad.py:2 SEC001", ctx)

    def test_multiedit_baseline_is_rebuilt_in_reverse(self):
        edits = [{"old_string": "return a", "new_string": "return a + 1"}, {"old_string": "return b", "new_string": "return b + 2"}]
        self.file.write_text(BAD + "def fa(a):\n    return a + 1\ndef fb(b):\n    return b + 2\n")
        event = json.dumps({"tool_name": "MultiEdit", "tool_input": {"file_path": str(self.file), "edits": edits}})
        r = run_hook(event)
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_write_reports_all_findings(self):
        event = json.dumps({"tool_name": "Write", "tool_input": {"file_path": str(self.file), "content": BAD}})
        r = run_hook(event)
        self.assertIn("bad.py:2 SEC001", json.loads(r.stdout)["hookSpecificOutput"]["additionalContext"])

    def test_failure_prints_class_and_message_to_stderr(self):
        r = run_hook(json.dumps({"tool_input": {}}))
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        self.assertEqual(r.stderr.strip(), "principles hook skipped: KeyError: 'file_path'")
        r = run_hook("not json")
        self.assertRegex(r.stderr.strip(), r"^principles hook skipped: JSONDecodeError: .+")
        self.assertEqual(len(r.stderr.strip().splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
