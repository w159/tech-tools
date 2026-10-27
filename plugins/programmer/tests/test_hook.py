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


if __name__ == "__main__":
    unittest.main()
