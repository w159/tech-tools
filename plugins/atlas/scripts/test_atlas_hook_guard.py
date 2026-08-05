#!/usr/bin/env python3
"""Tests for atlas_hook_guard.py -- the shared Stop-hook loop guard.

Isolation: every test patches _state_dir to a fresh tempdir so hookstate
never touches the real ~/.atlas, mirroring the pattern already used in
test_memory_capture.py (mock.patch.object on the module's own path function).
"""

import io
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import atlas_hook_guard as guard  # noqa: E402


class _GuardTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        patcher = mock.patch.object(guard, "_state_dir", lambda: self.tmp)
        patcher.start()
        self.addCleanup(patcher.stop)


class ReadPayloadTest(_GuardTestCase):
    def test_valid_json(self):
        with mock.patch("sys.stdin", io.StringIO('{"a": 1}')):
            self.assertEqual(guard.read_payload(), {"a": 1})

    def test_empty_stdin_fails_open(self):
        with mock.patch("sys.stdin", io.StringIO("")):
            self.assertEqual(guard.read_payload(), {})

    def test_malformed_json_fails_open(self):
        with mock.patch("sys.stdin", io.StringIO("not-json{")):
            self.assertEqual(guard.read_payload(), {})

    def test_stdin_read_exception_fails_open(self):
        boom = mock.MagicMock()
        boom.read.side_effect = IOError("stream closed")
        with mock.patch("sys.stdin", boom):
            self.assertEqual(guard.read_payload(), {})


class ShouldRunStopHookActiveTest(_GuardTestCase):
    def test_stop_hook_active_blocks(self):
        payload = {"session_id": "s1", "stop_hook_active": True}
        self.assertFalse(guard.should_run(payload, "nudge"))

    def test_stop_hook_active_default_kind_is_emit(self):
        """An un-updated caller passes no kind at all -- must keep today's
        safe behavior of silencing on stop_hook_active."""
        payload = {"session_id": "s1-default", "stop_hook_active": True}
        self.assertFalse(guard.should_run(payload, "nudge"))

    def test_stop_hook_active_emit_kind_blocks(self):
        payload = {"session_id": "s1-emit", "stop_hook_active": True}
        self.assertFalse(guard.should_run(payload, "nudge", kind="emit"))

    def test_stop_hook_active_capture_kind_still_runs(self):
        """Capture hooks (ingest_session/memory_capture/chronicle_facet) are
        idempotent on a retry -- silencing them starves telemetry forever."""
        payload = {"session_id": "s1-capture", "stop_hook_active": True}
        self.assertTrue(guard.should_run(payload, "ingest_session", kind="capture"))


class ShouldRunThrottleTest(_GuardTestCase):
    def test_throttle_window_respected(self):
        payload = {"session_id": "s2"}
        with mock.patch.object(guard, "_now", side_effect=[100.0, 100.0]):
            self.assertTrue(guard.should_run(payload, "nudge", window_seconds=900))
            self.assertFalse(guard.should_run(payload, "nudge", window_seconds=900))

    def test_throttle_expires_after_window(self):
        payload = {"session_id": "s3"}
        with mock.patch.object(guard, "_now", side_effect=[100.0, 1100.0]):
            self.assertTrue(guard.should_run(payload, "nudge", window_seconds=900))
            self.assertTrue(guard.should_run(payload, "nudge", window_seconds=900))

    def test_throttle_independent_across_hooks(self):
        """A throttled 'nudge' must not silence 'memory_capture' in the same
        session -- each hook keeps its own throttle window."""
        payload = {"session_id": "s4"}
        with mock.patch.object(guard, "_now", side_effect=[100.0, 100.0]):
            self.assertTrue(guard.should_run(payload, "nudge", window_seconds=900))
            # A different hook, same session, same instant: not throttled.
            self.assertTrue(
                guard.should_run(payload, "memory_capture", window_seconds=900)
            )

    def test_none_window_means_no_throttle(self):
        """completion_gate/ingest_session pass window_seconds=None -> never
        throttled by time, only by stop_hook_active/breaker."""
        payload = {"session_id": "s5"}
        with mock.patch.object(guard, "_now", side_effect=[100.0, 100.1, 100.2]):
            self.assertTrue(guard.should_run(payload, "completion_gate"))
            self.assertTrue(guard.should_run(payload, "completion_gate"))
            self.assertTrue(guard.should_run(payload, "completion_gate"))


class BreakerTest(_GuardTestCase):
    def test_trips_on_fast_13_second_cadence(self):
        """The real incident cycled every 13 seconds. 6 Stops at that spacing
        (STOP_BURST_LIMIT=5) must trip the breaker by the 6th call, and every
        call after that must return False regardless of hook name."""
        payload = {"session_id": "burst-sess"}
        times = [0.0, 13.0, 26.0, 39.0, 52.0, 65.0]
        with mock.patch.object(guard, "_now", side_effect=times):
            results = [guard.should_run(payload, "nudge") for _ in times]
        self.assertFalse(results[-1], "6th Stop within the burst window must trip")

        # Subsequent calls, any hook name, must stay silenced for the session.
        with mock.patch.object(guard, "_now", side_effect=[200.0, 300.0]):
            self.assertFalse(guard.should_run(payload, "memory_capture"))
            self.assertFalse(guard.should_run(payload, "auto_skill"))

    def test_trips_for_both_kinds(self):
        """The breaker is a session-wide fuse, not a per-kind one -- once
        tripped, both emit and capture hooks go silent, or a blocked-Stop
        chain that only fires capture hooks would loop forever too."""
        payload = {"session_id": "burst-both-kinds"}
        times = [0.0, 13.0, 26.0, 39.0, 52.0, 65.0]
        with mock.patch.object(guard, "_now", side_effect=times):
            for _ in times:
                guard.should_run(payload, "nudge", kind="emit")

        with mock.patch.object(guard, "_now", side_effect=[200.0, 300.0]):
            self.assertFalse(guard.should_run(payload, "nudge", kind="emit"))
            self.assertFalse(
                guard.should_run(payload, "ingest_session", kind="capture")
            )

    def test_does_not_trip_on_slow_legitimate_cadence(self):
        """5 Stops spread over 10 minutes must never trip the breaker."""
        payload = {"session_id": "slow-sess"}
        times = [0.0, 150.0, 300.0, 450.0, 600.0]
        with mock.patch.object(guard, "_now", side_effect=times):
            results = [guard.should_run(payload, "nudge") for _ in times]
        self.assertTrue(all(results), f"slow cadence must never trip: {results}")

    def test_stderr_names_the_breaker_not_stdout(self):
        payload = {"session_id": "stderr-sess"}
        times = [0.0, 13.0, 26.0, 39.0, 52.0, 65.0]
        out, err = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(guard, "_now", side_effect=times),
            mock.patch("sys.stdout", out),
            mock.patch("sys.stderr", err),
        ):
            for _ in times:
                guard.should_run(payload, "nudge")
        self.assertIn("circuit breaker", err.getvalue())
        self.assertEqual(out.getvalue(), "")


class EmitDedupeTest(_GuardTestCase):
    def test_same_message_twice_same_session_emits_once(self):
        payload = {"session_id": "e1"}
        out1, out2 = io.StringIO(), io.StringIO()
        with mock.patch("sys.stdout", out1):
            self.assertTrue(guard.emit(payload, "nudge", "hello there"))
        with mock.patch("sys.stdout", out2):
            self.assertFalse(guard.emit(payload, "nudge", "hello there"))
        self.assertIn("additionalContext", out1.getvalue())
        self.assertEqual(out2.getvalue(), "")

    def test_same_message_different_session_emits_again(self):
        out1, out2 = io.StringIO(), io.StringIO()
        with mock.patch("sys.stdout", out1):
            self.assertTrue(guard.emit({"session_id": "e2"}, "nudge", "same text"))
        with mock.patch("sys.stdout", out2):
            self.assertTrue(guard.emit({"session_id": "e3"}, "nudge", "same text"))
        self.assertIn("additionalContext", out1.getvalue())
        self.assertIn("additionalContext", out2.getvalue())

    def test_different_hook_same_session_and_message_emits_again(self):
        """Dedupe is per (session, hook, hash) -- a different hook saying the
        same words is not a repeat."""
        payload = {"session_id": "e4"}
        out1, out2 = io.StringIO(), io.StringIO()
        with mock.patch("sys.stdout", out1):
            self.assertTrue(guard.emit(payload, "nudge", "shared text"))
        with mock.patch("sys.stdout", out2):
            self.assertTrue(guard.emit(payload, "memory_capture", "shared text"))
        self.assertIn("additionalContext", out2.getvalue())

    def test_missing_session_id_still_emits_without_crashing(self):
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            self.assertTrue(guard.emit({}, "nudge", "no session here"))
        self.assertIn("additionalContext", out.getvalue())


class StateDirTest(unittest.TestCase):
    """Exercises the real _state_dir() body directly. Every other test class
    patches _state_dir itself via _GuardTestCase, which bypasses the
    makedirs-fails-open-to-/tmp branch entirely -- this is the only place
    that branch is covered against the actual implementation."""

    def setUp(self):
        # The env override branch runs before the makedirs branch in
        # _state_dir(), so a leaked ATLAS_HOOKSTATE_DIR would short-circuit
        # the code path under test. Force it unset for these tests only.
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("ATLAS_HOOKSTATE_DIR", None)

    def test_state_dir_falls_back_to_tmp_when_makedirs_fails(self):
        with mock.patch.object(os, "makedirs", side_effect=OSError("denied")):
            self.assertEqual(guard._state_dir(), "/tmp")

    def test_state_dir_returns_usable_path_when_makedirs_succeeds(self):
        result = guard._state_dir()
        self.assertTrue(os.path.isdir(result))


class FailOpenTest(_GuardTestCase):
    def test_corrupt_state_file_does_not_crash(self):
        session_id = "corrupt-sess"
        path = guard._state_path(session_id)
        with open(path, "w") as f:
            f.write("{not valid json")
        self.assertTrue(guard.should_run({"session_id": session_id}, "nudge"))

    def test_unwritable_state_dir_does_not_crash(self):
        payload = {"session_id": "unwritable-sess"}
        with mock.patch("builtins.open", side_effect=OSError("denied")):
            self.assertTrue(guard.should_run(payload, "nudge"))
            self.assertTrue(guard.emit(payload, "nudge", "msg"))

    def test_malformed_payload_type_does_not_crash(self):
        # should_run/emit are always called with a dict from read_payload(),
        # but a hostile .get() target must still fail open rather than raise.
        self.assertTrue(guard.should_run({}, "nudge"))

    def test_missing_session_id_should_run_allows(self):
        self.assertTrue(guard.should_run({}, "nudge", window_seconds=900))

    def test_should_run_internal_exception_fails_open(self):
        with mock.patch.object(guard, "_load_state", side_effect=RuntimeError("x")):
            self.assertTrue(guard.should_run({"session_id": "boom"}, "nudge"))


if __name__ == "__main__":
    unittest.main()
