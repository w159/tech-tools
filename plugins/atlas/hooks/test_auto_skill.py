#!/usr/bin/env python3
"""Tests for auto_skill.py — error surfacing and reason logging (H3-auto-skill-swallow).

Coverage strategy: in-process calls to auto_skill.main() with mocked sys.stdin,
sys.modules["skill_factory"] stubs, and a temp marker path. Subprocess tests
contribute nothing to coverage, so the heavy lifting is all in-process.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HOOK_DIR = os.path.dirname(__file__)
sys.path.insert(0, HOOK_DIR)
sys.path.insert(0, os.path.join(HOOK_DIR, "..", "scripts"))

import atlas_hook_guard  # noqa: E402
import auto_skill  # noqa: E402


class _StubFactory:
    """Minimal stand-in for skill_factory used by auto_skill.main()."""

    def __init__(self, return_value=None, raise_exc=None):
        self.return_value = return_value
        self.raise_exc = raise_exc

    def auto_create_from_session(self):
        if self.raise_exc is not None:
            raise self.raise_exc
        return self.return_value


class AutoSkillTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.hookstate_dir = os.path.join(self.tmpdir, "hookstate")
        os.environ.pop("ATLAS_AUTO_SKILL", None)

    def _run_main(
        self,
        stub,
        *,
        stdin_data="",
        stdin_read_exc=None,
        env_off=False,
        hookstate_dir=None,
    ):
        """Run auto_skill.main() with a stubbed skill_factory, capture output.

        hookstate_dir overrides atlas_hook_guard's state dir; if None, uses
        self.hookstate_dir (isolated from real ~/.atlas, and shared across
        calls within one test so the throttle/breaker can be exercised).
        stdin_read_exc (if set) makes sys.stdin.read raise instead of returning
        stdin_data.
        """
        sys.modules["skill_factory"] = stub
        self.addCleanup(sys.modules.pop, "skill_factory", None)

        if env_off:
            os.environ["ATLAS_AUTO_SKILL"] = "off"
            self.addCleanup(os.environ.pop, "ATLAS_AUTO_SKILL", None)
        else:
            os.environ.pop("ATLAS_AUTO_SKILL", None)

        if stdin_read_exc is not None:
            stdin_obj = mock.MagicMock()
            stdin_obj.read.side_effect = stdin_read_exc
        else:
            stdin_obj = io.StringIO(stdin_data)

        out = io.StringIO()
        err = io.StringIO()
        patches = [
            mock.patch.object(
                atlas_hook_guard,
                "_state_dir",
                lambda: hookstate_dir or self.hookstate_dir,
            ),
            mock.patch("sys.stdin", stdin_obj),
            mock.patch("sys.stdout", out),
            mock.patch("sys.stderr", err),
            mock.patch(
                "sys.exit",
                side_effect=lambda code=0: (_ for _ in ()).throw(SystemExit(code)),
            ),
        ]

        for p in patches:
            p.start()
            self.addCleanup(p.stop)

        try:
            auto_skill.main()
        except SystemExit:
            pass
        return out.getvalue(), err.getvalue()

    # --- Existing reason/surfacing tests (kept green) ---

    def test_skill_factory_error_is_surfaced(self):
        """A raised skill_factory error must be observable, not silently swallowed."""
        stub = _StubFactory(raise_exc=RuntimeError("boom-curator-down"))
        out, err = self._run_main(stub)
        combined = out + err
        self.assertIn(
            "boom-curator-down",
            combined,
            f"skill_factory error must be surfaced to stderr or additionalContext; "
            f"got stdout={out!r} stderr={err!r}",
        )

    def test_created_false_reason_logged(self):
        """When created=False, the reason must appear in output, not be discarded."""
        stub = _StubFactory(
            return_value={"created": False, "reason": "no learnable signals"}
        )
        out, err = self._run_main(stub)
        combined = out + err
        self.assertIn(
            "no learnable signals",
            combined,
            f"created=False reason must be logged; got stdout={out!r} stderr={err!r}",
        )

    # --- New in-process coverage tests ---

    def test_created_true_emits_additional_context(self):
        """The worthy-session create path reports the new skill via additionalContext."""
        stub = _StubFactory(
            return_value={
                "created": True,
                "name": "deploy-rollback",
                "lessons": ["l1", "l2"],
                "session_id": "abcdef1234567890",
            }
        )
        out, err = self._run_main(stub)
        self.assertIn("additionalContext", out)
        self.assertIn("deploy-rollback", out)
        self.assertIn("2 lesson", out)
        # session_id is truncated to 8 chars in the message
        self.assertIn("abcdef12", out)

    def test_disabled_via_env_exits_zero(self):
        """ATLAS_AUTO_SKILL=off short-circuits before touching skill_factory."""
        stub = _StubFactory(raise_exc=AssertionError("must not be called"))
        out, err = self._run_main(stub, env_off=True)
        # No output, no skill_factory invocation, no crash.
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_throttled_recent_marker_exits_zero(self):
        """A second call within WINDOW_SECONDS for the same session is throttled
        by atlas_hook_guard.should_run and never reaches skill_factory again."""
        session_payload = json.dumps({"session_id": "auto-skill-throttle-sess"})
        stub_first = _StubFactory(return_value={"created": False, "reason": "first"})
        self._run_main(stub_first, stdin_data=session_payload)

        stub_second = _StubFactory(
            raise_exc=AssertionError("must not be called when throttled")
        )
        out, err = self._run_main(stub_second, stdin_data=session_payload)
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_stdin_read_exception_is_swallowed(self):
        """A failing stdin.read must not crash the hook."""
        stub = _StubFactory(return_value={"created": False, "reason": "stdin-broke-ok"})
        out, err = self._run_main(stub, stdin_read_exc=IOError("stdin gone"))
        # stdin failure swallowed; main proceeded and logged the reason.
        self.assertIn("stdin-broke-ok", out + err)

    def test_main_block_catches_non_systemexit_exception(self):
        """The if __name__ == '__main__' guard catches a real exception and exits 0.

        We exec the source with __name__=='__main__' and sys.exit replaced so the
        inner sys.exit(0) raises RuntimeError (a non-SystemExit). That propagates
        out of main(), the outer `except Exception` catches it, and the guard
        calls sys.exit(0) again (which also raises). We assert the guard ran.
        """
        src_path = os.path.join(HOOK_DIR, "auto_skill.py")
        with open(src_path) as f:
            source = f.read()

        guard_called = mock.MagicMock()

        def _fake_exit(_code=0):
            guard_called()
            raise RuntimeError("forced non-SystemExit to exercise outer except")

        g: dict = {"__name__": "__main__", "__file__": src_path}
        # Avoid real side effects: throttle returns False, stdin reads empty,
        # skill_factory is a stub whose import succeeds but whose call path
        # is never reached because sys.exit fires first on the env check path.
        # Patch builtins.open so no real marker file is written.
        with (
            mock.patch("sys.exit", side_effect=_fake_exit),
            mock.patch("builtins.open", side_effect=OSError("no writes")),
            mock.patch("os.path.getmtime", side_effect=OSError("no mtime")),
            mock.patch("sys.stdin", io.StringIO("")),
        ):
            # ATLAS_AUTO_SKILL must not be "off" or main exits before any sys.exit
            # that raises; env_off path still calls sys.exit(0) which raises here.
            os.environ.pop("ATLAS_AUTO_SKILL", None)
            with self.assertRaises(RuntimeError):
                exec(compile(source, src_path, "exec"), g)
        # The outer except called sys.exit(0) -> guard_called fired at least twice
        # (once inside main, once in the outer except). At least once proves the
        # guard's except branch ran.
        self.assertGreaterEqual(guard_called.call_count, 2)

    # --- A subprocess end-to-end smoke test (does not contribute coverage) ---

    def test_subprocess_disabled_env_exits_zero(self):
        """Running the hook with ATLAS_AUTO_SKILL=off exits 0 and prints nothing."""
        env = dict(os.environ)
        env["ATLAS_AUTO_SKILL"] = "off"
        proc = subprocess.run(
            [sys.executable, os.path.join(HOOK_DIR, "auto_skill.py")],
            input="",
            capture_output=True,
            text=True,
            env=env,
            timeout=10,
        )
        self.assertEqual(proc.returncode, 0, f"stderr={proc.stderr!r}")


if __name__ == "__main__":
    unittest.main()
