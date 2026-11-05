"""connector_credential_watch unit contracts, run in-process (the subprocess tests in
test_connector_credential_watch.py are invisible to coverage): state path, server naming, response
text extraction, auth-failure classification, the once-per-server state file and main()."""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest import mock

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import connector_credential_watch as w  # noqa: E402


class StatePathTest(unittest.TestCase):
    def test_atlas_home_wins(self):
        with mock.patch.dict(os.environ, {"ATLAS_HOME": "/x/ah"}):
            self.assertEqual(w._state_path(), Path("/x/ah/connector_auth_warned.json"))

    def test_falls_back_to_dot_atlas_under_home(self):
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_HOME"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(
            Path, "home", return_value=Path("/x/home")
        ):
            self.assertEqual(
                w._state_path(), Path("/x/home/.atlas/connector_auth_warned.json")
            )


class ContentServerTest(unittest.TestCase):
    def test_hyphen_and_underscore_names_are_content_servers(self):
        for name in (
            "mcp__lean-ctx__ctx_read",
            "mcp__lean_ctx__ctx_read",
            "mcp__plugin_context-mode_context-mode__ctx_execute",
            "mcp__plugin_claude-mem_mcp-search__search",
            "mcp__serena__find_symbol",
            "mcp__context7__query-docs",
            "mcp__microsoft-docs__search",
        ):
            self.assertTrue(w._is_content_server(name), name)

    def test_api_connectors_are_not(self):
        for name in ("mcp__plugin_armada_connectwise__cw_x", "mcp__ramp__list"):
            self.assertFalse(w._is_content_server(name), name)


class ServerOfTest(unittest.TestCase):
    def test_armada_and_atlas_prefixes(self):
        for name in (
            "mcp__plugin_armada_connectwise__cw_x",
            "mcp__armada_connectwise_cw_x",
            "mcp__atlas_ConnectWise__x",
        ):
            self.assertEqual(w._server_of(name), "connectwise", name)

    def test_plain_three_part_name_uses_the_middle_part(self):
        self.assertEqual(w._server_of("mcp__ramp__list_cards"), "ramp")

    def test_two_part_name_is_returned_whole(self):
        self.assertEqual(w._server_of("mcp__ramp"), "mcp__ramp")
        self.assertEqual(w._server_of("ramp"), "ramp")


class BlockTextTest(unittest.TestCase):
    def test_string_passes_through(self):
        self.assertEqual(w._block_text("plain"), "plain")

    def test_text_blocks_are_joined_with_newlines_and_others_skipped(self):
        content = [
            {"type": "text", "text": "one"},
            {"type": "image", "data": "x"},
            {"type": "text", "text": 5},
            "stray",
            {"type": "text", "text": "two"},
        ]
        self.assertEqual(w._block_text(content), "one\ntwo")

    def test_other_types_are_empty(self):
        for v in (None, 5, {"text": "x"}):
            self.assertEqual(w._block_text(v), "")
        self.assertEqual(w._block_text([]), "")


class StatusOfTest(unittest.TestCase):
    def test_int_and_digit_string_statuses(self):
        self.assertEqual(w._status_of({"status": 403}), 403)
        self.assertEqual(w._status_of({"status_code": " 401 "}), 401)
        self.assertEqual(w._status_of({"statusCode": "400"}), 400)
        self.assertEqual(w._status_of({"http_status": 500}), 500)

    def test_bool_and_junk_are_ignored_and_next_key_is_tried(self):
        self.assertIsNone(w._status_of({"status": True}))
        self.assertIsNone(w._status_of({"status": "ok"}))
        self.assertIsNone(w._status_of({}))
        self.assertEqual(w._status_of({"status": True, "status_code": 403}), 403)
        self.assertEqual(w._status_of({"status": "ok", "statusCode": 401}), 401)


class ErrorTextTest(unittest.TestCase):
    def test_is_error_returns_block_text_or_the_dumped_response(self):
        self.assertEqual(
            w.error_text({"isError": True, "content": [{"type": "text", "text": "bad"}]}),
            "bad",
        )
        self.assertEqual(w.error_text({"is_error": True, "content": "bad"}), "bad")
        dumped = w.error_text({"isError": True})
        self.assertEqual(json.loads(dumped), {"isError": True})

    def test_is_error_text_is_capped_at_two_thousand(self):
        self.assertEqual(len(w.error_text({"isError": True, "content": "x" * 5000})), 2000)

    def test_error_field_or_pure_status_body_is_an_error_envelope(self):
        for resp in (
            {"error": "Unauthorized"},
            {"status": 403},
            {"status": 401, "message": "nope"},
            {"statusCode": "400", "detail": "bad token"},
        ):
            self.assertEqual(json.loads(w.error_text(resp)), resp)

    def test_status_beside_payload_keys_is_data(self):
        self.assertEqual(w.error_text({"status": 403, "items": [1, 2]}), "")
        self.assertEqual(w.error_text({"status": 200}), "")
        self.assertEqual(w.error_text({"status": 500, "message": "x"}), "")

    def test_plain_text_needs_an_opening_banner(self):
        self.assertEqual(w.error_text("  Error: 401 Unauthorized  "), "Error: 401 Unauthorized")
        self.assertEqual(w.error_text("HTTP 403 forbidden"), "HTTP 403 forbidden")
        self.assertEqual(w.error_text("403 Forbidden"), "403 Forbidden")
        self.assertEqual(w.error_text("status: 401"), "status: 401")
        self.assertEqual(w.error_text("here is the data: error 401"), "")
        self.assertEqual(len(w.error_text("Error " + "x" * 5000)), 2000)

    def test_json_in_a_string_and_content_lists_are_unwrapped(self):
        self.assertEqual(
            json.loads(w.error_text('{"error": "invalid token"}')),
            {"error": "invalid token"},
        )
        self.assertEqual(w.error_text('{"rows": [1]}'), "")
        self.assertEqual(w.error_text("{not json"), "")
        self.assertEqual(
            w.error_text([{"type": "text", "text": "Error: invalid token"}]),
            "Error: invalid token",
        )
        self.assertEqual(
            w.error_text({"content": [{"type": "text", "text": "all fine"}]}), ""
        )
        self.assertEqual(
            w.error_text({"content": [{"type": "text", "text": "HTTP 401"}]}), "HTTP 401"
        )

    def test_non_text_types_carry_no_signal(self):
        for v in (None, 5, 3.5, True):
            self.assertEqual(w.error_text(v), "")
        self.assertEqual(w.error_text({}), "")


class LooksLikeAuthFailureTest(unittest.TestCase):
    def test_empty_is_false(self):
        self.assertIs(w.looks_like_auth_failure(""), False)

    def test_hard_auth_shapes(self):
        for text in (
            "HTTP 401",
            "status_code: 403",
            "403 Forbidden",
            "Unauthorized",
            "invalid_token",
            "token expired",
            "Invalid client",
            "authentication failed",
            "invalid_grant",
        ):
            self.assertIs(w.looks_like_auth_failure(text), True, text)

    def test_generic_errors_are_false(self):
        for text in ("Error: not found", "HTTP 500", "rate limited"):
            self.assertIs(w.looks_like_auth_failure(text), False, text)

    def test_bare_400_counts_only_when_the_body_names_a_credential(self):
        self.assertIs(w.looks_like_auth_failure("HTTP 400 invalid token"), True)
        self.assertIs(w.looks_like_auth_failure("status 400 Unauthorized"), True)
        self.assertIs(w.looks_like_auth_failure("status 400 forbidden"), False)
        self.assertIs(w.looks_like_auth_failure("status 400 authentication failed"), False)
        self.assertIs(w.looks_like_auth_failure("status 400 invalid token 403"), True)

    def test_only_the_first_two_thousand_chars_are_inspected(self):
        self.assertIs(w.looks_like_auth_failure("x" * 2000 + " Unauthorized"), False)
        self.assertIs(w.looks_like_auth_failure("x" * 1900 + " Unauthorized"), True)


class RecordTest(unittest.TestCase):
    def test_hands_the_exception_to_atlas_faults(self):
        import atlas_faults

        exc = RuntimeError("x")
        with mock.patch.object(atlas_faults, "record") as rec:
            w._record(exc)
        rec.assert_called_once_with("connector_credential_watch", exc)

    def test_a_failing_recorder_never_raises(self):
        import atlas_faults

        with mock.patch.object(atlas_faults, "record", side_effect=OSError("disk")):
            self.assertIsNone(w._record(RuntimeError("x")))


class LockedStateTest(unittest.TestCase):
    def test_returns_the_shared_lock_and_its_timeout_class(self):
        import atlas_memory

        path = Path(tempfile.mkdtemp()) / "s.json"
        lock, busy = w._locked_state(path)
        self.assertIs(busy, atlas_memory.LockTimeout)
        with lock:
            self.assertTrue(path.with_suffix(".json.lock").exists())

    def test_the_lock_is_taken_with_the_short_timeout(self):
        import atlas_memory

        with mock.patch.object(atlas_memory, "_file_lock") as fl:
            w._locked_state(Path("/x/s.json"))
        fl.assert_called_once_with(Path("/x/s.json"), timeout=w.LOCK_TIMEOUT_S)
        self.assertLessEqual(w.LOCK_TIMEOUT_S, 2.0)

    def test_unavailable_lock_helper_falls_back_to_unlocked_and_records(self):
        import atlas_memory

        with mock.patch.object(
            atlas_memory, "_file_lock", side_effect=RuntimeError("no lock")
        ), mock.patch.object(w, "_record") as rec:
            lock, busy = w._locked_state(Path("/x/s.json"))
        self.assertIs(busy, OSError)
        with lock:
            pass
        self.assertIsInstance(rec.call_args[0][0], RuntimeError)


class CheckAndMarkTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.path = self.dir / "sub" / "warned.json"

    def _state(self):
        return json.loads(self.path.read_text(encoding="utf-8"))

    def test_first_call_marks_and_second_reports_warned(self):
        self.assertIs(w._check_and_mark("s1", "ramp", self.path), False)
        self.assertEqual(self._state(), {"s1|ramp": True})
        self.assertIs(w._check_and_mark("s1", "ramp", self.path), True)
        self.assertIs(w._check_and_mark("s1", "cipp", self.path), False)
        self.assertIs(w._check_and_mark("s2", "ramp", self.path), False)
        self.assertEqual(set(self._state()), {"s1|ramp", "s1|cipp", "s2|ramp"})

    def test_no_temp_file_is_left_behind(self):
        w._check_and_mark("s1", "ramp", self.path)
        self.assertEqual([p.name for p in self.path.parent.iterdir()], ["warned.json"])

    def test_corrupt_or_non_object_state_restarts_clean(self):
        self.path.parent.mkdir(parents=True)
        for text in ("not json", "[1, 2]"):
            self.path.write_text(text, encoding="utf-8")
            self.assertIs(w._check_and_mark("s1", "ramp", self.path), False)
            self.assertEqual(self._state(), {"s1|ramp": True})

    def test_file_is_bounded_to_the_newest_two_hundred_keys(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text(
            json.dumps({"k%03d" % i: True for i in range(200)}), encoding="utf-8"
        )
        self.assertIs(w._check_and_mark("s", "new", self.path), False)
        state = self._state()
        self.assertEqual(len(state), 200)
        self.assertNotIn("k000", state)
        self.assertIn("k001", state)
        self.assertIn("s|new", state)

    def test_exactly_two_hundred_keys_are_all_kept(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text(
            json.dumps({"k%03d" % i: True for i in range(199)}), encoding="utf-8"
        )
        w._check_and_mark("s", "new", self.path)
        state = self._state()
        self.assertEqual(len(state), 200)
        self.assertIn("k000", state)

    def test_a_failed_write_is_recorded_and_still_reports_not_warned(self):
        with mock.patch.object(Path, "write_text", side_effect=OSError("ro")), \
                mock.patch.object(w, "_record") as rec:
            self.assertIs(w._check_and_mark("s1", "ramp", self.path), False)
        self.assertIsInstance(rec.call_args[0][0], OSError)


class AlreadyWarnedTest(unittest.TestCase):
    def test_locked_path_marks_once(self):
        path = Path(tempfile.mkdtemp()) / "warned.json"
        with mock.patch.object(w, "_state_path", return_value=path):
            self.assertIs(w._already_warned("s1", "ramp"), False)
            self.assertIs(w._already_warned("s1", "ramp"), True)

    def test_busy_lock_proceeds_unlocked_and_records(self):
        path = Path(tempfile.mkdtemp()) / "warned.json"

        class Busy(OSError):
            pass

        class Lock:
            def __enter__(self):
                raise Busy("busy")

            def __exit__(self, *a):
                return False

        with mock.patch.object(w, "_state_path", return_value=path), mock.patch.object(
            w, "_locked_state", return_value=(Lock(), Busy)
        ), mock.patch.object(w, "_record") as rec:
            self.assertIs(w._already_warned("s1", "ramp"), False)
            self.assertIs(w._already_warned("s1", "ramp"), True)
        self.assertIsInstance(rec.call_args[0][0], Busy)


class MainTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        env = mock.patch.dict(
            os.environ, {"ATLAS_HOME": self.home, "ATLAS_CONNECTOR_WATCH": "on"}
        )
        env.start()
        self.addCleanup(env.stop)

    def _main(self, payload):
        raw = payload if isinstance(payload, str) else json.dumps(payload)
        with mock.patch("sys.stdin", new=io.StringIO(raw)), mock.patch(
            "sys.stdout", new=io.StringIO()
        ) as out:
            code = w.main()
        return code, out.getvalue()

    @staticmethod
    def _payload(tool="mcp__plugin_armada_connectwise__cw_x", resp=None, sid="s1"):
        return {
            "tool_name": tool,
            "session_id": sid,
            "tool_response": resp
            if resp is not None
            else {"isError": True, "content": [{"type": "text", "text": "HTTP 401 Unauthorized"}]},
        }

    def test_auth_failure_emits_posttooluse_context_naming_server_and_tool(self):
        code, out = self._main(self._payload())
        self.assertEqual(code, 0)
        spec = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(spec["hookEventName"], "PostToolUse")
        self.assertIn("connectwise returned an auth failure on mcp__plugin_armada_connectwise__cw_x", spec["additionalContext"])
        self.assertIn("[atlas] STALE CREDENTIAL", spec["additionalContext"])

    def test_second_failure_on_the_same_server_and_session_is_silent(self):
        self.assertEqual(self._main(self._payload())[0], 0)
        self.assertEqual(self._main(self._payload()), (0, ""))
        self.assertNotEqual(self._main(self._payload(sid="s2"))[1], "")

    def test_state_file_is_written_under_atlas_home(self):
        self._main(self._payload())
        state = json.loads(
            Path(self.home, "connector_auth_warned.json").read_text(encoding="utf-8")
        )
        self.assertEqual(state, {"s1|connectwise": True})

    def test_missing_session_id_is_keyed_as_empty(self):
        p = self._payload()
        del p["session_id"]
        self._main(p)
        state = json.loads(
            Path(self.home, "connector_auth_warned.json").read_text(encoding="utf-8")
        )
        self.assertEqual(state, {"|connectwise": True})

    def test_kill_switch_is_case_insensitive(self):
        with mock.patch.dict(os.environ, {"ATLAS_CONNECTOR_WATCH": "OFF"}):
            self.assertEqual(self._main(self._payload()), (0, ""))

    def test_silent_cases(self):
        for payload in (
            self._payload(tool="Bash"),
            self._payload(tool="mcp__lean-ctx__ctx_read"),
            self._payload(resp={"rows": [1]}),
            self._payload(resp="all fine"),
            {"session_id": "s"},
            [1, 2],
            "null",
        ):
            self.assertEqual(self._main(payload), (0, ""), payload)

    def test_empty_stdin_is_silent_and_untraced(self):
        with mock.patch.object(w, "_record") as rec:
            self.assertEqual(self._main(""), (0, ""))
        rec.assert_not_called()

    def test_garbage_stdin_is_traced_and_silent(self):
        with mock.patch.object(w, "_record") as rec:
            self.assertEqual(self._main("{nope"), (0, ""))
        self.assertIsInstance(rec.call_args[0][0], ValueError)

    def test_raw_control_characters_in_strings_are_tolerated(self):
        raw = '{"tool_name": "mcp__ramp__x", "session_id": "s", "tool_response": "Error: 401\n Unauthorized"}'
        code, out = self._main(raw)
        self.assertIn("ramp returned an auth failure", out)

    def test_internal_error_is_traced_and_fails_open(self):
        with mock.patch.object(w, "error_text", side_effect=RuntimeError("boom")), \
                mock.patch.object(w, "_record") as rec:
            self.assertEqual(self._main(self._payload()), (0, ""))
        self.assertIsInstance(rec.call_args[0][0], RuntimeError)


if __name__ == "__main__":
    unittest.main()
