#!/usr/bin/env python3
"""Tests for hooks/todo_capture.py (TodoWrite to board mirror)."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
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

HOOKS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hooks.json")


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

    def test_work_state_write_upserts_task_metadata(self):
        payload = {
            "session_id": "sess1",
            "cwd": self.root,
            "tool_name": "mcp__mcp_search__work_state_write",
            "tool_input": {
                "list": "release",
                "fields": {
                    "task": "ship it",
                    "status": "doing",
                    "details": "waiting on CI",
                    "evidence": "red test captured",
                    "work_product": "/tmp/report.md",
                },
            },
        }
        self.assertEqual(run_hook(payload), 0)
        item = atlas_todo.load(self.root)["items"][0]
        self.assertEqual(item["content"], "ship it")
        self.assertEqual(item["status"], "in_progress")
        self.assertEqual(item["origin"], "codex-work-state")
        self.assertEqual(item["work_state_list"], "release")
        self.assertEqual(item["details"], "waiting on CI")
        self.assertEqual(item["evidence"], "red test captured")
        self.assertEqual(item["work_product"], "/tmp/report.md")

        first_id = item["id"]
        payload["tool_input"]["fields"] = {
            "task": "ship it",
            "status": "done",
            "evidence": "green",
        }
        self.assertEqual(run_hook(payload), 0)
        item = atlas_todo.load(self.root)["items"][0]
        self.assertEqual(item["id"], first_id)
        self.assertEqual(item["status"], "completed")
        self.assertEqual(item["work_state_status"], "done")
        self.assertEqual(item["evidence"], "green")
        self.assertEqual(item["details"], "waiting on CI")

    def test_work_state_list_is_part_of_task_identity_and_dropped_is_closed(self):
        def update(list_name):
            return run_hook(
                {
                    "session_id": "sess1",
                    "cwd": self.root,
                    "tool_name": "mcp__mcp_search__work_state_write",
                    "tool_input": {
                        "list": list_name,
                        "fields": {"task": "same task", "status": "dropped"},
                    },
                }
            )

        self.assertEqual(update("one"), 0)
        self.assertEqual(update("two"), 0)
        items = atlas_todo.load(self.root)["items"]
        self.assertEqual(len(items), 2)
        self.assertEqual({i["work_state_list"] for i in items}, {"one", "two"})
        self.assertEqual({i["status"] for i in items}, {"completed"})
        self.assertEqual({i["work_state_status"] for i in items}, {"dropped"})

    def test_work_state_non_task_state_update_is_ignored(self):
        rc = run_hook(
            {
                "session_id": "sess1",
                "cwd": self.root,
                "tool_name": "mcp__mcp_search__work_state_write",
                "tool_input": {"list": "release", "fields": {"status": "done"}},
            }
        )
        self.assertEqual(rc, 0)
        self.assertEqual(atlas_todo.load(self.root)["items"], [])


    def test_work_state_tool_names_reach_the_dispatcher(self):
        with open(HOOKS, encoding="utf-8") as handle:
            matcher = json.load(handle)["hooks"]["PostToolUse"][0]["matcher"]
        self.assertIn("mcp__mcp_search__work_state_write", matcher)
        self.assertIn("mcp__mcp_search_work_state_write", matcher)

    def test_todo_write_prefix_becomes_board_phase(self):
        rc = run_hook(
            {
                "session_id": "sess1",
                "cwd": self.root,
                "tool_name": "TodoWrite",
                "tool_input": {
                    "todos": [
                        {"content": "[implement] build it", "status": "in_progress"},
                        {"content": "[verify] run the suites", "status": "pending"},
                        {"content": "[bogus] not a phase", "status": "pending"},
                        {"content": "plain item", "status": "pending"},
                    ]
                },
            }
        )
        self.assertEqual(rc, 0)
        items = atlas_todo.load(self.root)["items"]
        self.assertEqual(
            {i["content"]: i.get("phase") for i in items},
            {
                "[implement] build it": "implement",
                "[verify] run the suites": "verify",
                "[bogus] not a phase": None,
                "plain item": None,
            },
        )
        for item in items:
            if item["content"] in ("[bogus] not a phase", "plain item"):
                self.assertNotIn("phase", item)

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


AGENT = {"tool_name": "Agent", "tool_input": {"subagent_type": "atlas:implementer"}}
MUX = {"tool_name": "Bash", "tool_input": {"command": 'python3 "/x/atlas_mux.py" spawn-team --class fix'}}
CODEX = {"tool_name": "collaboration.spawn_agent", "tool_input": {"agent_type": "implementer"}}


def run_nudge(payload, env_extra=None):
    env = dict(os.environ)
    env.update(env_extra or {})
    p = subprocess.run([sys.executable, HOOK], input=json.dumps(payload).encode(), capture_output=True, timeout=20, env=env)
    return p.returncode, p.stdout.decode()


class TodoNudge(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def payload(self, base, sid="s1"):
        return {**base, "session_id": sid, "cwd": self.root}

    def test_empty_board_nudges_once_with_the_set_command(self):
        rc, out = run_nudge(self.payload(AGENT))
        self.assertEqual(rc, 0)
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("atlas_todo.py", ctx)
        self.assertIn(" set ", ctx)
        self.assertIn("--session s1", ctx)
        self.assertEqual(run_nudge(self.payload(MUX)), (0, ""))  # once per session

    def test_mux_spawn_team_counts_as_a_dispatch(self):
        self.assertIn("--session s2", run_nudge(self.payload(MUX, "s2"))[1])

    def test_codex_spawn_agent_counts_as_a_dispatch(self):
        self.assertIn("--session s3", run_nudge(self.payload(CODEX, "s3"))[1])

    def test_silent_when_the_session_has_items_or_tool_is_not_a_dispatch(self):
        atlas_todo.mirror(self.root, [{"content": "x", "status": "pending"}], "s1")
        self.assertEqual(run_nudge(self.payload(AGENT)), (0, ""))
        other = {"tool_name": "Agent", "tool_input": {"subagent_type": "general-purpose"}}
        self.assertEqual(run_nudge(self.payload(other, "s9")), (0, ""))
        bash = {"tool_name": "Bash", "tool_input": {"command": "ls"}}
        self.assertEqual(run_nudge(self.payload(bash, "s9")), (0, ""))

    def test_todo_off_disables(self):
        self.assertEqual(run_nudge(self.payload(AGENT), {"ATLAS_TODO": "off"}), (0, ""))




if __name__ == "__main__":
    unittest.main()
