#!/usr/bin/env python3
"""Tests for hooks/todo_capture.py (TodoWrite to board mirror)."""

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_todo  # noqa: E402

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "todo_capture.py")


def run_hook(payload, env_extra=None):
    env = dict(os.environ)
    if env_extra:
        env.update(env_extra)
    proc = subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload).encode(),
        capture_output=True,
        timeout=20,
        env=env,
    )
    return proc.returncode


class TodoCapture(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def test_todo_write_mirrors_to_board(self):
        rc = run_hook(
            {
                "session_id": "sess1",
                "cwd": self.root,
                "tool_name": "TodoWrite",
                "tool_input": {
                    "todos": [
                        {"content": "one", "status": "completed"},
                        {"content": "two", "status": "pending"},
                    ]
                },
            }
        )
        self.assertEqual(rc, 0)
        board = atlas_todo.load(self.root)
        statuses = {i["content"]: i["status"] for i in board["items"]}
        self.assertEqual(statuses, {"one": "completed", "two": "pending"})

    def test_non_todowrite_events_are_ignored(self):
        rc = run_hook(
            {
                "session_id": "sess1",
                "cwd": self.root,
                "tool_name": "Edit",
                "tool_input": {"file_path": "/tmp/x.py"},
            }
        )
        self.assertEqual(rc, 0)
        self.assertEqual(atlas_todo.load(self.root)["items"], [])

    def test_bad_input_fails_open(self):
        self.assertEqual(run_hook({}), 0)
        proc = subprocess.run(
            [sys.executable, HOOK],
            input=b"not json",
            capture_output=True,
            timeout=20,
        )
        self.assertEqual(proc.returncode, 0)

    def test_off_switch(self):
        rc = run_hook(
            {
                "session_id": "sess1",
                "cwd": self.root,
                "tool_name": "TodoWrite",
                "tool_input": {"todos": [{"content": "x", "status": "pending"}]},
            },
            env_extra={"ATLAS_TODO": "off"},
        )
        self.assertEqual(rc, 0)
        self.assertEqual(atlas_todo.load(self.root)["items"], [])


if __name__ == "__main__":
    unittest.main()
