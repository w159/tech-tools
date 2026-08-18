import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HOOK = os.path.join(os.path.dirname(__file__), "nudge.py")

# Make both the hook module and atlas_db importable in-process so the real
# code paths are traced for coverage (subprocess.run contributes nothing).
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import atlas_db  # noqa: E402
import nudge  # noqa: E402


def run_hook(payload, env):
    return subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class NudgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(
            os.environ,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            # Fresh hookstate per test: never touch real ~/.atlas, and never let
            # a shared session_id across test methods trip the breaker/throttle.
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
        )
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(c)
        pid = atlas_db.register_project(c, "/repo/x")
        atlas_db.start_run(c, pid, "sess-chat")
        atlas_db.start_run(c, pid, "sess-orch")
        atlas_db.mark_orchestrating(c, "sess-orch")
        c.close()

    def test_silent_for_non_orchestration(self):
        r = run_hook({"session_id": "sess-chat", "cwd": self.tmp}, self.env)
        self.assertEqual(r.stdout.strip(), "")

    def test_fires_for_orchestration(self):
        r = run_hook({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("additionalContext", r.stdout)

    def test_db_error_does_not_nudge_nonorchestration(self):
        # Point ATLAS_DB at a directory so atlas_db.connect() raises; the
        # is_orchestrating check must NOT fall through to a spurious nudge for
        # a non-orchestration session.
        bad_env = dict(self.env, ATLAS_DB=self.tmp)
        r = run_hook({"session_id": "sess-chat", "cwd": self.tmp}, bad_env)
        self.assertEqual(r.stdout.strip(), "")


class InProcessMainTest(unittest.TestCase):
    """Drive nudge.main() in-process with mocked stdin/env so coverage counts
    the real branches. sys.exit(0) inside main() raises SystemExit, caught here."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmp, "atlas.db")
        c = atlas_db.connect(self.db_path)
        atlas_db.init(c)
        pid = atlas_db.register_project(c, "/repo/x")
        atlas_db.start_run(c, pid, "sess-chat")
        atlas_db.start_run(c, pid, "sess-orch")
        atlas_db.mark_orchestrating(c, "sess-orch")
        c.close()
        self.env = dict(
            os.environ,
            ATLAS_DB=self.db_path,
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
        )

    def _run_main(self, payload, env=None, stdin_text=None):
        """Invoke nudge.main() with controlled stdin/env and isolated hookstate.
        Returns (exit_code, stdout, stderr)."""
        env = env if env is not None else self.env
        if stdin_text is None:
            stdin_text = json.dumps(payload)
        stdin = io.StringIO(stdin_text)
        out = io.StringIO()
        err = io.StringIO()
        code = None
        with (
            mock.patch("sys.stdin", stdin),
            mock.patch.dict(os.environ, env, clear=False),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            try:
                nudge.main()
            except SystemExit as exc:
                code = exc.code
        return code, out.getvalue(), err.getvalue()

    def test_non_orchestration_session_is_noop(self):
        code, out, err = self._run_main({"session_id": "sess-chat"})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_orchestration_with_no_capture_nudges_to_capture(self):
        with (
            mock.patch.object(nudge, "_check_memory_captured", return_value=False),
        ):
            code, out, err = self._run_main({"session_id": "sess-orch"})
        self.assertEqual(code, 0)
        self.assertIn("additionalContext", out)
        self.assertIn("self-improvement check", out)
        self.assertIn("capture it", out)

    def test_throttle_skips_recent_marker(self):
        # First call fires and records the throttle window in hookstate; a
        # second call for the same session, inside the window, stays silent.
        with (
            mock.patch.object(nudge, "_check_memory_captured", return_value=False),
        ):
            first_code, first_out, _ = self._run_main({"session_id": "sess-orch"})
            code, out, err = self._run_main({"session_id": "sess-orch"})
        self.assertIn("additionalContext", first_out)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_db_error_skips_without_spurious_nudge(self):
        # ATLAS_DB pointing at a directory makes atlas_db.connect() raise; the
        # M7 fix requires exit 0 with a stderr note and NO stdout nudge.
        bad_env = dict(self.env, ATLAS_DB=self.tmp)
        code, out, err = self._run_main({"session_id": "sess-orch"}, env=bad_env)
        self.assertEqual(code, 0)
        self.assertEqual(out, "")
        self.assertIn("[atlas] nudge: skipping, DB error:", err)

    def test_memory_captured_is_silent(self):
        """memory_capture already wrote the facts. Announcing that on Stop is
        additionalContext, which costs a whole extra model turn to say nothing.
        A Stop hook speaks only when it needs something done."""
        with (
            mock.patch.object(nudge, "_check_memory_captured", return_value=True),
        ):
            code, out, err = self._run_main({"session_id": "sess-orch"})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")



    def test_empty_stdin_falls_back_to_empty_payload(self):
        # No session_id -> is_orchestrating("") is False -> no-op exit 0.
        code, out, err = self._run_main({}, stdin_text="")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_invalid_json_falls_back_to_empty_payload(self):
        code, out, err = self._run_main({}, stdin_text="not-json-at-all")
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_stdin_read_exception_does_not_crash(self):
        # sys.stdin.read() raising must be swallowed; raw stays "" -> no-op.
        stdin = mock.MagicMock()
        stdin.read.side_effect = OSError("closed")
        out = io.StringIO()
        err = io.StringIO()
        code = None
        with (
            mock.patch("sys.stdin", stdin),
            mock.patch.dict(os.environ, self.env, clear=False),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            try:
                nudge.main()
            except SystemExit as exc:
                code = exc.code
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue(), "")


# Throttle-window and marker-path coverage moved to
# atlas_hook_guard/test_atlas_hook_guard.py, which now owns that invariant
# for all five Stop hooks.


class CheckMemoryCapturedTest(unittest.TestCase):
    def _mem_path(self, home):
        return os.path.join(home, ".atlas", "memory", "MEMORY.md")

    def test_recent_memory_returns_true(self):
        home = tempfile.mkdtemp()
        mpath = self._mem_path(home)
        os.makedirs(os.path.dirname(mpath), exist_ok=True)
        with open(mpath, "w") as f:
            f.write("fact")
        os.utime(mpath, (time.time(), time.time()))
        with mock.patch.dict(os.environ, {"HOME": home}, clear=False):
            self.assertTrue(nudge._check_memory_captured())

    def test_missing_memory_returns_false(self):
        home = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"HOME": home}, clear=False):
            self.assertFalse(nudge._check_memory_captured())

    def test_stale_memory_returns_false(self):
        home = tempfile.mkdtemp()
        mpath = self._mem_path(home)
        os.makedirs(os.path.dirname(mpath), exist_ok=True)
        with open(mpath, "w") as f:
            f.write("fact")
        old = time.time() - 120  # > 60s window
        os.utime(mpath, (old, old))
        with mock.patch.dict(os.environ, {"HOME": home}, clear=False):
            self.assertFalse(nudge._check_memory_captured())

    def test_getmtime_error_returns_false(self):
        # Memory file exists but getmtime raises -> except branch -> False,
        # not a silent crash.
        home = tempfile.mkdtemp()
        mpath = self._mem_path(home)
        os.makedirs(os.path.dirname(mpath), exist_ok=True)
        with open(mpath, "w") as f:
            f.write("fact")
        with (
            mock.patch.dict(os.environ, {"HOME": home}, clear=False),
            mock.patch.object(os.path, "getmtime", side_effect=OSError("boom")),
        ):
            self.assertFalse(nudge._check_memory_captured())


class OuterMainGuardTest(unittest.TestCase):
    """Cover the fail-open `if __name__ == '__main__'` guard: an exception
    escaping main() must be swallowed and the process exit 0 (mirrors the
    existing auto_skill guard test)."""

    def test_main_block_catches_exception_exits_zero(self):
        src_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nudge.py")
        with open(src_path) as f:
            source = f.read()

        guard_calls = mock.MagicMock()

        def _fake_exit(_code=0):
            guard_calls()
            raise RuntimeError("forced non-SystemExit to exercise outer except")

        tmp = tempfile.mkdtemp()
        g: dict = {"__name__": "__main__", "__file__": src_path}
        with (
            mock.patch("sys.exit", side_effect=_fake_exit),
            mock.patch("sys.stdin", io.StringIO("")),
            mock.patch("sys.stdout", io.StringIO()),
            mock.patch("sys.stderr", io.StringIO()),
            mock.patch.dict(
                os.environ, {"ATLAS_DB": os.path.join(tmp, "atlas.db")}, clear=False
            ),
        ):
            # Empty session_id -> not orchestrating -> sys.exit(0) inside
            # main's try block; the patched sys.exit raises RuntimeError, which
            # main's inner `except Exception` catches and re-exits (raising
            # again), then the outer guard catches and exits once more.
            with self.assertRaises(RuntimeError):
                exec(compile(source, src_path, "exec"), g)
        self.assertGreaterEqual(guard_calls.call_count, 2)


class NudgeHooksJsonBindingTest(unittest.TestCase):
    """DEFECT 3: the self-improvement nudge must fire only on Stop, never on
    SubagentStop. Landing on SubagentStop injects additionalContext into a
    dispatched subagent's context right before it composes its final
    response, which the subagent answers instead of returning its
    deliverable -- costing a full resume round trip per occurrence."""

    def test_nudge_not_bound_to_subagent_stop(self):
        hj = os.path.join(os.path.dirname(__file__), "hooks.json")
        with open(hj) as f:
            data = json.load(f)
        subagent_stop_blob = json.dumps(data.get("hooks", {}).get("SubagentStop", []))
        self.assertNotIn("nudge.py", subagent_stop_blob)

    def test_nudge_still_bound_to_stop(self):
        hj = os.path.join(os.path.dirname(__file__), "hooks.json")
        with open(hj) as f:
            data = json.load(f)
        stop_blob = json.dumps(data.get("hooks", {}).get("Stop", []))
        self.assertIn("nudge.py", stop_blob)


if __name__ == "__main__":
    unittest.main()
