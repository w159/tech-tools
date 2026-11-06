#!/usr/bin/env python3
"""In-process tests for hooks/todo_capture.py: dispatch detection, nudge, task create/update, main()."""

import os as _os
import sys as _sys

_HERE = _os.path.dirname(_os.path.abspath(__file__))
_sys.path.insert(0, _os.path.join(_HERE, "..", "scripts"))
_sys.path.insert(0, _HERE)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

import atlas_todo  # noqa: E402
import todo_capture as tc  # noqa: E402


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.root = self._t.name
        self.addCleanup(self._t.cleanup)

    def items(self):
        return atlas_todo.load(self.root)["items"]


class IsDispatch(unittest.TestCase):
    def test_agent_and_task_need_atlas_prefix(self):
        for tool in ("Agent", "Task"):
            self.assertTrue(tc._is_dispatch({"tool_name": tool, "tool_input": {"subagent_type": "atlas:x"}}))
            self.assertFalse(tc._is_dispatch({"tool_name": tool, "tool_input": {"subagent_type": "general"}}))
            self.assertFalse(tc._is_dispatch({"tool_name": tool, "tool_input": {"subagent_type": "xatlas:x"}}))
            self.assertFalse(tc._is_dispatch({"tool_name": tool, "tool_input": {}}))
            self.assertFalse(tc._is_dispatch({"tool_name": tool}))

    def test_bash_needs_mux_and_spawn_verb(self):
        b = lambda c: {"tool_name": "Bash", "tool_input": {"command": c}}
        self.assertTrue(tc._is_dispatch(b("python3 atlas_mux.py spawn --x")))
        self.assertTrue(tc._is_dispatch(b("python3 atlas_mux.py spawn-team --x")))
        self.assertFalse(tc._is_dispatch(b("python3 atlas_mux.py status")))
        self.assertFalse(tc._is_dispatch(b("python3 other.py spawn --x")))
        self.assertFalse(tc._is_dispatch(b("python3 atlas_mux.py spawn")))  # verb needs trailing space
        self.assertFalse(tc._is_dispatch({"tool_name": "Bash", "tool_input": {}}))

    def test_other_tools(self):
        self.assertFalse(tc._is_dispatch({"tool_name": "Read", "tool_input": {"subagent_type": "atlas:x"}}))
        self.assertFalse(tc._is_dispatch({}))


class Response(unittest.TestCase):
    def test_shapes(self):
        self.assertEqual(tc._response({"tool_response": {"a": 1}}), {"a": 1})
        self.assertEqual(tc._response({"tool_response": '{"a": 2}'}), {"a": 2})
        self.assertEqual(tc._response({"tool_response": "not json"}), {})
        self.assertEqual(tc._response({"tool_response": "[1]"}), {})
        self.assertEqual(tc._response({"tool_response": [1]}), {})
        self.assertEqual(tc._response({}), {})


class Nudge(TmpCase):
    AGENT = {"tool_name": "Agent", "tool_input": {"subagent_type": "atlas:implementer"}}

    def nudge(self, data):
        buf = io.StringIO()
        with redirect_stdout(buf):
            tc._nudge_if_board_empty(data)
        return buf.getvalue()

    def test_message_contents_and_marker(self):
        out = self.nudge({**self.AGENT, "cwd": self.root, "session_id": "s 1/x"})
        msg = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(msg["hookEventName"], "PostToolUse")
        ctx = msg["additionalContext"]
        self.assertTrue(ctx.startswith("[atlas] The board has no items for this session"))
        self.assertIn("--session 's 1/x'", ctx)
        self.assertIn(" set '[{\"content\": \"[implement] <what this worker delivers>\", \"status\": \"in_progress\"}]'", ctx)
        marker = atlas_todo.board_path(self.root).parent / "todo-nudged" / "s1x"
        self.assertEqual(marker.read_text(), "1")
        self.assertEqual(self.nudge({**self.AGENT, "cwd": self.root, "session_id": "s 1/x"}), "")

    def test_distinct_sessions_each_nudged(self):
        self.assertNotEqual(self.nudge({**self.AGENT, "cwd": self.root, "session_id": "a"}), "")
        self.assertNotEqual(self.nudge({**self.AGENT, "cwd": self.root, "session_id": "b"}), "")

    def test_empty_session_id_is_silent_even_on_empty_board(self):
        self.assertEqual(self.nudge({**self.AGENT, "cwd": self.root, "session_id": ""}), "")
        self.assertEqual(self.nudge({**self.AGENT, "cwd": self.root}), "")
        self.assertFalse((atlas_todo.board_path(self.root).parent / "todo-nudged").exists())

    def test_non_dispatch_silent(self):
        self.assertEqual(self.nudge({"tool_name": "Read", "cwd": self.root, "session_id": "s"}), "")

    def test_silent_when_session_has_items(self):
        atlas_todo.mirror(self.root, [{"content": "x", "status": "pending"}], "s")
        self.assertEqual(self.nudge({**self.AGENT, "cwd": self.root, "session_id": "s"}), "")

    def test_other_sessions_items_do_not_silence(self):
        atlas_todo.mirror(self.root, [{"content": "x", "status": "pending"}], "other")
        self.assertNotEqual(self.nudge({**self.AGENT, "cwd": self.root, "session_id": "s"}), "")

    def test_cwd_defaults_to_process_cwd(self):
        with mock.patch.object(tc.os, "getcwd", return_value=self.root):
            out = self.nudge({**self.AGENT, "session_id": "s"})
        self.assertNotEqual(out, "")
        self.assertTrue(atlas_todo.board_path(self.root).parent.joinpath("todo-nudged", "s").exists())


class TaskCreate(TmpCase):
    def create(self, **data):
        base = {"tool_input": {"subject": "do it"}, "tool_response": {"task": {"id": "7"}}}
        base.update(data)
        tc._task_create(self.root, "s1", base)

    def test_item_fields(self):
        before = atlas_todo._now()
        self.create()
        (it,) = self.items()
        self.assertEqual((it["content"], it["status"], it["owner"], it["origin"], it["session_id"]),
                         ("do it", "pending", None, "session", "s1"))
        self.assertEqual((it["task_id"], it["archived"], it["evidence"], it["completed_at"], it["claimed_at"]),
                         ("7", False, None, None, None))
        self.assertGreaterEqual(it["created_at"], before)
        self.assertEqual(it["created_at"], it["updated_at"])
        self.assertNotIn("phase", it)
        self.assertEqual(atlas_todo.load(self.root)["last_session_id"], "s1")

    def test_subject_from_response_when_input_lacks_it(self):
        self.create(tool_input={}, tool_response={"task": {"id": "7", "subject": "  from resp  "}})
        self.assertEqual(self.items()[0]["content"], "from resp")

    def test_input_subject_stripped_and_wins(self):
        self.create(tool_input={"subject": "  mine  "}, tool_response={"task": {"id": "7", "subject": "theirs"}})
        self.assertEqual(self.items()[0]["content"], "mine")

    def test_missing_id_or_subject_is_noop(self):
        self.create(tool_response={"task": {}})
        self.create(tool_response={})
        self.create(tool_response={"task": "str"})
        self.create(tool_input={"subject": "   "}, tool_response={"task": {"id": "1"}})
        self.assertEqual(self.items(), [])

    def test_numeric_id_stringified(self):
        self.create(tool_response={"task": {"id": 42}})
        self.assertEqual(self.items()[0]["task_id"], "42")

    def test_duplicate_same_session_ignored_other_session_added(self):
        self.create()
        self.create()
        self.assertEqual(len(self.items()), 1)
        tc._task_create(self.root, "s2", {"tool_input": {"subject": "do it"}, "tool_response": {"task": {"id": "7"}}})
        self.assertEqual(len(self.items()), 2)

    def test_phase_prefix_sets_phase(self):
        self.create(tool_input={"subject": "[implement] build"})
        self.assertEqual(self.items()[0]["phase"], "implement")

    def test_ids_unique(self):
        self.create()
        self.create(tool_response={"task": {"id": "8"}})
        a, b = self.items()
        self.assertNotEqual(a["id"], b["id"])


class TaskUpdate(TmpCase):
    def setUp(self):
        super().setUp()
        tc._task_create(self.root, "s1", {"tool_input": {"subject": "[plan] first"}, "tool_response": {"task": {"id": "1"}}})

    def update(self, sid="s1", resp=None, **fields):
        data = {"tool_input": fields}
        if resp is not None:
            data["tool_response"] = resp
        tc._task_update(self.root, sid, data)

    def test_status_transitions_and_completed_at(self):
        self.update(taskId="1", status="in_progress")
        self.assertEqual(self.items()[0]["status"], "in_progress")
        self.assertIsNone(self.items()[0]["completed_at"])
        self.update(taskId="1", status="completed")
        it = self.items()[0]
        self.assertEqual(it["status"], "completed")
        self.assertIsInstance(it["completed_at"], float)
        self.update(taskId="1", status="pending")
        it = self.items()[0]
        self.assertEqual((it["status"], it["completed_at"]), ("pending", None))

    def test_unknown_status_ignored_but_touched(self):
        before = self.items()[0]["updated_at"]
        with mock.patch.object(atlas_todo, "_now", return_value=before + 100):
            self.update(taskId="1", status="bogus")
        it = self.items()[0]
        self.assertEqual(it["status"], "pending")
        self.assertEqual(it["updated_at"], before + 100)

    def test_subject_rewrites_content_and_phase(self):
        self.update(taskId="1", subject="[test] second")
        it = self.items()[0]
        self.assertEqual((it["content"], it["phase"]), ("[test] second", "test"))
        self.update(taskId="1", subject="  plain  ")
        it = self.items()[0]
        self.assertEqual(it["content"], "plain")
        self.assertNotIn("phase", it)

    def test_blank_subject_keeps_content(self):
        self.update(taskId="1", subject="   ")
        self.assertEqual(self.items()[0]["content"], "[plan] first")

    def test_deleted_removes_item(self):
        self.update(taskId="1", status="deleted")
        self.assertEqual(self.items(), [])

    def test_no_task_id_is_noop(self):
        self.update(status="completed")
        self.update(taskId="", status="completed")
        self.assertEqual(self.items()[0]["status"], "pending")

    def test_success_false_ignored_but_true_or_missing_applies(self):
        self.update(taskId="1", status="completed", resp={"success": False})
        self.assertEqual(self.items()[0]["status"], "pending")
        self.update(taskId="1", status="in_progress", resp={"success": True})
        self.assertEqual(self.items()[0]["status"], "in_progress")
        self.update(taskId="1", status="completed", resp={})
        self.assertEqual(self.items()[0]["status"], "completed")

    def test_other_session_and_unknown_id_ignored(self):
        self.update(sid="s2", taskId="1", status="completed")
        self.update(taskId="99", status="completed")
        self.assertEqual(self.items()[0]["status"], "pending")

    def test_archived_item_is_not_updated(self):
        board = atlas_todo.load(self.root)
        board["items"][0]["archived"] = True
        atlas_todo.save(self.root, board)
        self.update(taskId="1", status="completed")
        self.assertEqual(self.items()[0]["status"], "pending")

    def test_numeric_task_id_matches(self):
        self.update(taskId=1, status="completed")
        self.assertEqual(self.items()[0]["status"], "completed")


class Main(TmpCase):
    def run_main(self, payload, env=None):
        with mock.patch.object(tc.atlas_hook_guard, "load_payload", return_value=payload), \
                mock.patch.dict(tc.os.environ, env or {}, clear=False):
            tc.os.environ.pop("ATLAS_TODO", None) if env is None else None
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = tc.main()
        return rc, buf.getvalue()

    def test_todowrite_mirrors_and_returns_zero(self):
        rc, _ = self.run_main({"tool_name": "TodoWrite", "cwd": self.root, "session_id": "s",
                               "tool_input": {"todos": [{"content": "a", "status": "pending"}]}})
        self.assertEqual(rc, 0)
        self.assertEqual([(i["content"], i["session_id"]) for i in self.items()], [("a", "s")])

    def test_todowrite_non_list_ignored(self):
        for todos in ("x", None, {"a": 1}):
            rc, _ = self.run_main({"tool_name": "TodoWrite", "cwd": self.root, "session_id": "s",
                                   "tool_input": {"todos": todos}})
            self.assertEqual(rc, 0)
        self.assertEqual(self.items(), [])

    def test_todowrite_empty_session_id_ok(self):
        rc, _ = self.run_main({"tool_name": "TodoWrite", "cwd": self.root,
                               "tool_input": {"todos": [{"content": "a", "status": "pending"}]}})
        self.assertEqual(rc, 0)

    def test_mirror_failure_records_fault_and_returns_zero(self):
        with mock.patch.object(atlas_todo, "mirror", side_effect=RuntimeError("boom")), \
                mock.patch.object(tc.atlas_faults, "record") as rec:
            rc, _ = self.run_main({"tool_name": "TodoWrite", "cwd": self.root, "session_id": "s",
                                   "tool_input": {"todos": []}})
        self.assertEqual(rc, 0)
        self.assertEqual(rec.call_args.args[0], "todo_capture")
        self.assertIsInstance(rec.call_args.args[1], RuntimeError)
        self.assertEqual(rec.call_args.args[2], self.root)

    def test_task_create_via_main(self):
        rc, _ = self.run_main({"tool_name": "TaskCreate", "cwd": self.root, "session_id": "s",
                               "tool_input": {"subject": "t"}, "tool_response": {"task": {"id": "1"}}})
        self.assertEqual(rc, 0)
        self.assertEqual(self.items()[0]["session_id"], "s")

    def test_task_update_via_main(self):
        tc._task_create(self.root, "s", {"tool_input": {"subject": "t"}, "tool_response": {"task": {"id": "1"}}})
        rc, _ = self.run_main({"tool_name": "TaskUpdate", "cwd": self.root, "session_id": "s",
                               "tool_input": {"taskId": "1", "status": "completed"}})
        self.assertEqual(rc, 0)
        self.assertEqual(self.items()[0]["status"], "completed")

    def test_task_failure_records_fault(self):
        with mock.patch.object(tc, "_task_create", side_effect=ValueError("x")), \
                mock.patch.object(tc.atlas_faults, "record") as rec:
            rc, _ = self.run_main({"tool_name": "TaskCreate", "cwd": self.root, "session_id": "s"})
        self.assertEqual(rc, 0)
        self.assertEqual(rec.call_args.args[2], self.root)

    def test_task_missing_session_id_passes_empty_string(self):
        with mock.patch.object(tc, "_task_update") as upd:
            rc, _ = self.run_main({"tool_name": "TaskUpdate", "cwd": self.root})
        self.assertEqual(rc, 0)
        upd.assert_called_once()
        self.assertEqual(upd.call_args.args[:2], (self.root, ""))

    def test_other_tool_runs_nudge(self):
        rc, out = self.run_main({"tool_name": "Agent", "cwd": self.root, "session_id": "s",
                                 "tool_input": {"subagent_type": "atlas:w"}})
        self.assertEqual(rc, 0)
        self.assertIn("additionalContext", out)

    def test_nudge_failure_records_fault(self):
        with mock.patch.object(tc, "_nudge_if_board_empty", side_effect=OSError("x")), \
                mock.patch.object(tc.atlas_faults, "record") as rec:
            rc, _ = self.run_main({"tool_name": "Read", "cwd": self.root})
        self.assertEqual(rc, 0)
        self.assertEqual(rec.call_args.args[:1], ("todo_capture",))
        self.assertEqual(rec.call_args.args[2], self.root)

    def test_off_switch_values(self):
        for v in ("0", "off", "FALSE", "No"):
            rc, out = self.run_main({"tool_name": "TodoWrite", "cwd": self.root, "session_id": "s",
                                     "tool_input": {"todos": [{"content": "a"}]}}, env={"ATLAS_TODO": v})
            self.assertEqual((rc, out), (0, ""))
        self.assertEqual(self.items(), [])
        rc, _ = self.run_main({"tool_name": "TodoWrite", "cwd": self.root, "session_id": "s",
                               "tool_input": {"todos": [{"content": "a"}]}}, env={"ATLAS_TODO": "on"})
        self.assertEqual(len(self.items()), 1)

    def test_missing_cwd_defaults_to_getcwd(self):
        with mock.patch.object(tc.os, "getcwd", return_value=self.root):
            self.run_main({"tool_name": "TodoWrite", "session_id": "s",
                           "tool_input": {"todos": [{"content": "a", "status": "pending"}]}})
        self.assertEqual(len(self.items()), 1)


class LazyTodo(unittest.TestCase):
    def test_forwards_attributes_to_real_module(self):
        self.assertIs(tc.atlas_todo.counts, atlas_todo.counts)
        self.assertEqual(tc.atlas_todo.BOARD_NAME, atlas_todo.BOARD_NAME)


if __name__ == "__main__":
    unittest.main()
